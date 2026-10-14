import { createFileRoute, redirect } from '@tanstack/react-router'
import { buildAuthUrl } from '../../../server/oidc'

export const Route = createFileRoute('/api/auth/login')({
  loader: async () => {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const redirectUri = `${appUrl}/api/auth/callback`

    const { url, codeVerifier, state } = await buildAuthUrl(redirectUri)

    const oidcState = JSON.stringify({ codeVerifier, state })
    const cookieValue = `oidc_state=${encodeURIComponent(oidcState)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`

    throw redirect({
      href: url.toString(),
      statusCode: 302,
      headers: {
        'Set-Cookie': cookieValue,
      },
    })
  },
})
