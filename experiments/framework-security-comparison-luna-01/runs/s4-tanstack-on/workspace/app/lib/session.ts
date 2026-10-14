import { randomUUID } from 'node:crypto'
import { getWebRequest } from '@tanstack/start/server'
import db from './db'

export interface SessionData {
  userId?: string
  displayName?: string
  oidcState?: string
  oidcNonce?: string
}

const SESSION_COOKIE = 'session'
const SESSION_TTL_SECS = 7 * 24 * 60 * 60

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx < 0) continue
    const key = pair.slice(0, idx).trim()
    const val = pair.slice(idx + 1).trim()
    if (key) result[key] = val
  }
  return result
}

function getSessionIdFromHeader(cookieHeader: string): string | undefined {
  return parseCookies(cookieHeader)[SESSION_COOKIE]
}

function loadSession(sessionId: string): SessionData {
  const row = db
    .prepare(`SELECT data FROM sessions WHERE id = ? AND expires_at > datetime('now')`)
    .get(sessionId) as { data: string } | undefined
  if (!row) return {}
  try {
    return JSON.parse(row.data) as SessionData
  } catch {
    return {}
  }
}

export function getSession(): SessionData {
  const request = getWebRequest()
  const cookieHeader = request.headers.get('cookie') ?? ''
  const sessionId = getSessionIdFromHeader(cookieHeader)
  if (!sessionId) return {}
  return loadSession(sessionId)
}

export function getSessionFromRequest(request: Request): SessionData {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const sessionId = getSessionIdFromHeader(cookieHeader)
  if (!sessionId) return {}
  return loadSession(sessionId)
}

export function getSessionIdFromRequest(request: Request): string | undefined {
  const cookieHeader = request.headers.get('cookie') ?? ''
  return getSessionIdFromHeader(cookieHeader)
}

export function createSession(data: SessionData): string {
  const id = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECS * 1000).toISOString()
  db.prepare(`INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)`)
    .run(id, JSON.stringify(data), expiresAt)
  return id
}

export function updateSession(id: string, data: SessionData): void {
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECS * 1000).toISOString()
  db.prepare(`UPDATE sessions SET data = ?, expires_at = ? WHERE id = ?`)
    .run(JSON.stringify(data), expiresAt, id)
}

export function deleteSession(id: string): void {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id)
}

export function sessionCookieHeader(sessionId: string, appUrl: string): string {
  const secure = appUrl.startsWith('https://') ? '; Secure' : ''
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${SESSION_TTL_SECS}`
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

export function cleanExpiredSessions(): void {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run()
}
