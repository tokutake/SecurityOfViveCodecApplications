import { createFileRoute, redirect } from '@tanstack/react-router'
import { exchangeCode, getDisplayName } from '../../../server/oidc'
import { upsertUser, db } from '../../../server/db'
import { randomUUID } from 'crypto'

function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key) {
      result[key.trim()] = decodeURIComponent(rest.join('='))
    }
  }
  return result
}

function createSessionCookie(userId: number): string {
  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    sessionId,
    userId,
    expiresAt
  )
  const maxAge = 14 * 24 * 60 * 60
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `session_id=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}

export const Route = createFileRoute('/api/auth/callback')({
  loader: async ({ context }) => {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const redirectUri = `${appUrl}/api/auth/callback`

    // Get the raw request to read cookies and URL
    const { getRequest } = await import('@tanstack/react-start/server')
    const request = getRequest()
    const cookieHeader = request.headers.get('cookie') ?? ''
    const cookies = parseCookies(cookieHeader)
    const oidcStateCookieRaw = cookies['oidc_state']

    if (!oidcStateCookieRaw) {
      throw redirect({ href: '/?error=missing_state', statusCode: 302 })
    }

    let codeVerifier: string
    let state: string
    try {
      const parsed = JSON.parse(oidcStateCookieRaw) as { codeVerifier: string; state: string }
      codeVerifier = parsed.codeVerifier
      state = parsed.state
    } catch {
      throw redirect({ href: '/?error=invalid_state', statusCode: 302 })
    }

    try {
      const claims = await exchangeCode(request.url, codeVerifier, state, redirectUri)
      const displayName = getDisplayName(claims)
      const userId = upsertUser(claims.sub, displayName)

      const sessionCookie = createSessionCookie(userId)
      const clearOidcState = 'oidc_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'

      throw redirect({
        href: '/',
        statusCode: 302,
        headers: [
          ['Set-Cookie', sessionCookie],
          ['Set-Cookie', clearOidcState],
        ],
      })
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'options' in err) throw err
      console.error('OIDC callback error:', err)
      throw redirect({
        href: `/?error=${encodeURIComponent(err instanceof Error ? err.message : 'auth_failed')}`,
        statusCode: 302,
      })
    }
  },
})
