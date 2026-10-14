import { DatabaseSync } from 'node:sqlite'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const dbPath = resolve(process.env.DATABASE_PATH || 'data/mori.sqlite')
mkdirSync(dirname(dbPath), { recursive: true })
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
db.exec(`CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, sub TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_sub TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, sub TEXT NOT NULL, PRIMARY KEY(group_id, sub));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, sub TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);`)

type User = { sub: string; name: string }
const secret = () => { if (!process.env.OIDC_CLIENT_SECRET) throw new Error('OIDC_CLIENT_SECRET is not configured'); return process.env.OIDC_CLIENT_SECRET }
const mac = (text: string) => createHmac('sha256', secret()).update(text).digest('base64url')
function sign(value: object) { const body = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${body}.${mac(body)}` }
function unsign<T>(token: string | undefined): T | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = Buffer.from(mac(body)), actual = Buffer.from(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()) as T } catch { return null }
}
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
function readCookie(req: Request, name: string) { return req.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) }
export function currentUser(req: Request): User | null {
  const data = unsign<User & { exp: number }>(readCookie(req, 'mori_session'))
  return data && data.exp > Date.now() && data.sub ? { sub: data.sub, name: data.name || 'ユーザー' } : null
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const unauthorized = () => json({ error: 'ログインしてください' }, 401)
const bad = (message: string) => json({ error: message }, 400)
const parse = async (req: Request) => { try { return await req.json() as Record<string, unknown> } catch { return {} } }
function safeText(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
const date = () => new Date().toISOString()

export async function handleApi(req: Request) {
  const url = new URL(req.url), path = url.pathname
  try {
    if (path === '/api/auth/login' && req.method === 'GET') {
      const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, ''), clientId = process.env.OIDC_CLIENT_ID, appUrl = process.env.APP_URL?.replace(/\/$/, '')
      if (!issuer || !clientId || !appUrl) return json({ error: 'OIDC_ISSUER、OIDC_CLIENT_ID、APP_URL を設定してください' }, 500)
      const discovery = await fetch(`${issuer}/.well-known/openid-configuration`).then(r => r.json()) as { authorization_endpoint: string }
      const state = randomBytes(24).toString('base64url'), nonce = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url')
      // PKCE uses SHA-256 as required by the OIDC Authorization Code Flow.
      const pkce = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      const codeChallenge = Buffer.from(pkce).toString('base64url')
      const auth = new URL(discovery.authorization_endpoint)
      auth.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: `${appUrl}/api/auth/callback`, scope: 'openid profile email', state, nonce, code_challenge: codeChallenge, code_challenge_method: 'S256' }).toString()
      return new Response(null, { status: 302, headers: { Location: auth.toString(), 'Set-Cookie': cookie('mori_flow', sign({ state, nonce, verifier, exp: Date.now() + 600000 }), 600) } })
    }
    if (path === '/api/auth/callback' && req.method === 'GET') {
      const flow = unsign<{state:string;nonce:string;verifier:string;exp:number}>(readCookie(req, 'mori_flow'))
      if (!flow || flow.exp < Date.now() || url.searchParams.get('state') !== flow.state || url.searchParams.get('error')) return new Response('認証を完了できませんでした。ログインからやり直してください。', { status: 400, headers: { 'Set-Cookie': clearCookie('mori_flow') } })
      const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, ''), appUrl = process.env.APP_URL?.replace(/\/$/, '')
      if (!issuer || !appUrl) return new Response('OIDC 設定がありません', { status: 500 })
      const discovery = await fetch(`${issuer}/.well-known/openid-configuration`).then(r => r.json()) as { token_endpoint:string; jwks_uri:string }
      const tokenResponse = await fetch(discovery.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: `${appUrl}/api/auth/callback`, client_id: process.env.OIDC_CLIENT_ID || '', client_secret: secret(), code_verifier: flow.verifier }) })
      if (!tokenResponse.ok) throw new Error('OIDC token exchange failed')
      const tokens = await tokenResponse.json() as { id_token?:string }
      if (!tokens.id_token) throw new Error('OIDC ID token is missing')
      const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(discovery.jwks_uri)), { issuer, audience: process.env.OIDC_CLIENT_ID })
      if (payload.nonce !== flow.nonce || typeof payload.sub !== 'string') throw new Error('OIDC ID token validation failed')
      const name = typeof payload.name === 'string' ? payload.name : typeof payload.preferred_username === 'string' ? payload.preferred_username : typeof payload.email === 'string' ? payload.email : 'ユーザー'
      const headers = new Headers({ Location: '/' })
      headers.append('Set-Cookie', cookie('mori_session', sign({ sub: payload.sub, name, exp: Date.now() + 7 * 86400000 }), 7 * 86400))
      headers.append('Set-Cookie', clearCookie('mori_flow'))
      return new Response(null, { status: 302, headers })
    }
    if (path === '/api/auth/logout' && req.method === 'POST') return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie('mori_session') } })
    const user = currentUser(req)
    if (path === '/api/me' && req.method === 'GET') return json({ user })
    if (path.startsWith('/api/') && !user) return unauthorized()
    if (req.method === 'POST' && path.startsWith('/api/')) {
      const origin = req.headers.get('origin')
      if (origin && process.env.APP_URL && new URL(origin).origin !== new URL(process.env.APP_URL).origin) return json({ error: 'リクエストを確認できません' }, 403)
    }
    if (path === '/api/posts' && req.method === 'GET') return json({ posts: db.prepare('SELECT id, sub, name, body, private, created_at AS createdAt FROM posts WHERE private = 0 OR sub = ? ORDER BY id DESC LIMIT 100').all(user!.sub) })
    if (path === '/api/posts' && req.method === 'POST') {
      const data = await parse(req), body = safeText(data.body, 1000)
      if (!body) return bad('投稿内容を入力してください')
      const result = db.prepare('INSERT INTO posts(sub,name,body,private,created_at) VALUES(?,?,?,?,?)').run(user!.sub, user!.name, body, data.private === true ? 1 : 0, date())
      return json({ id: result.lastInsertRowid }, 201)
    }
    if (path === '/api/groups' && req.method === 'GET') return json({ groups: db.prepare('SELECT g.id,g.name,g.created_at AS createdAt FROM groups g JOIN members m ON m.group_id=g.id WHERE m.sub=? ORDER BY g.id DESC').all(user!.sub) })
    if (path === '/api/groups' && req.method === 'POST') {
      const data = await parse(req), name = safeText(data.name, 60)
      if (!name) return bad('グループ名を入力してください')
      const invitees = Array.isArray(data.members) ? data.members.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 20) : []
      db.exec('BEGIN')
      try {
        const result = db.prepare('INSERT INTO groups(name,owner_sub,created_at) VALUES(?,?,?)').run(name,user!.sub,date())
        const id = Number(result.lastInsertRowid), add = db.prepare('INSERT OR IGNORE INTO members(group_id,sub) VALUES(?,?)')
        add.run(id,user!.sub); invitees.forEach(sub => add.run(id,sub)); db.exec('COMMIT')
        return json({ id }, 201)
      } catch (error) { db.exec('ROLLBACK'); throw error }
    }
    const groupMatch = path.match(/^\/api\/groups\/(\d+)(?:\/messages)?$/)
    if (groupMatch && req.method === 'GET') {
      const id = Number(groupMatch[1]), member = db.prepare('SELECT 1 FROM members WHERE group_id=? AND sub=?').get(id,user!.sub)
      if (!member) return json({ error: 'このグループのメンバーではありません' }, 403)
      if (path.endsWith('/messages')) return json({ messages: db.prepare('SELECT id,sub,name,body,created_at AS createdAt FROM messages WHERE group_id=? ORDER BY id ASC LIMIT 200').all(id) })
      return json({ group: db.prepare('SELECT id,name FROM groups WHERE id=?').get(id) })
    }
    const messagesMatch = path.match(/^\/api\/groups\/(\d+)\/messages$/)
    if (messagesMatch && req.method === 'POST') {
      const id = Number(messagesMatch[1]), member = db.prepare('SELECT 1 FROM members WHERE group_id=? AND sub=?').get(id,user!.sub)
      if (!member) return json({ error: 'このグループのメンバーではありません' }, 403)
      const body = safeText((await parse(req)).body, 1000)
      if (!body) return bad('メッセージを入力してください')
      const result = db.prepare('INSERT INTO messages(group_id,sub,name,body,created_at) VALUES(?,?,?,?,?)').run(id,user!.sub,user!.name,body,date())
      return json({ id: result.lastInsertRowid },201)
    }
    return json({ error: '見つかりません' },404)
  } catch (error) {
    console.error('API error:', error)
    return json({ error: error instanceof Error ? error.message : 'サーバーエラー' },500)
  }
}
