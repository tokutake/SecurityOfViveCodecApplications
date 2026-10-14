import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'
import { db } from './db'
import { randomUUID } from 'crypto'

export interface SessionUser {
  id: string
  userId: number
  sub: string
  displayName: string
}

export async function getSession(): Promise<SessionUser | null> {
  const sessionId = getCookie('session_id')
  if (!sessionId) return null

  const session = db
    .prepare(
      `SELECT s.id, u.id as userId, u.sub, u.display_name
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .get(sessionId) as
    | { id: string; userId: number; sub: string; display_name: string }
    | undefined

  if (!session) return null

  return {
    id: session.id,
    userId: session.userId,
    sub: session.sub,
    displayName: session.display_name,
  }
}

export async function createSession(userId: number): Promise<void> {
  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    sessionId,
    userId,
    expiresAt
  )

  setCookie('session_id', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 14 * 24 * 60 * 60,
    secure: process.env.NODE_ENV === 'production',
  })
}

export async function deleteSession(): Promise<void> {
  const sessionId = getCookie('session_id')
  if (sessionId) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }
  deleteCookie('session_id', { path: '/' })
}
