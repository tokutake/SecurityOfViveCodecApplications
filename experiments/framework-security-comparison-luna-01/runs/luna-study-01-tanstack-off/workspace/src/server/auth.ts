import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose'
import { getRequestHeader, setResponseHeader } from '@tanstack/react-start/server'
import { randomBytes, createHash } from 'node:crypto'

const cookieName = 'microsns_session'
const secret = () => {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters')
  return createHash('sha256').update(value).digest()
}
export type User = { sub: string; name: string }
function cookies() { return Object.fromEntries((getRequestHeader('cookie') || '').split(';').map(x => x.trim()).filter(Boolean).map(x => { const i=x.indexOf('='); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))] })) }
function setCookie(value: string, maxAge: number) { setResponseHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`) }
export async function currentUser(): Promise<User | null> {
  const token = cookies()[cookieName]
  if (!token) return null
  try { const { payload } = await jwtVerify(token, secret(), { issuer: process.env.APP_URL }); if (typeof payload.sub !== 'string' || typeof payload.name !== 'string') return null; return { sub: payload.sub, name: payload.name } } catch { return null }
}
export async function loginUrl(requestUrl: string) {
  const issuer = required('OIDC_ISSUER').replace(/\/$/, '')
  const client = required('OIDC_CLIENT_ID')
  const app = appUrl()
  const meta = await fetch(`${issuer}/.well-known/openid-configuration`).then(async r => { if (!r.ok) throw new Error('OIDC discovery failed'); return r.json() }) as { authorization_endpoint: string }
  const state = randomBytes(24).toString('base64url'), nonce = randomBytes(24).toString('base64url')
  const token = await new SignJWT({ state, nonce }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(secret())
  setResponseHeader('Set-Cookie', `microsns_oidc=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`)
  const url = new URL(meta.authorization_endpoint); url.search = new URLSearchParams({ client_id:client, response_type:'code', scope:'openid profile', redirect_uri:`${app}/auth/callback`, state, nonce }).toString()
  return url.toString()
}
export async function handleCallback(request: Request) {
  const u = new URL(request.url), state = u.searchParams.get('state'), code = u.searchParams.get('code'), saved = cookies().microsns_oidc
  if (!state || !code || !saved) throw new Error('Invalid OIDC callback')
  const { payload: flow } = await jwtVerify(saved, secret()); if (flow.state !== state || typeof flow.nonce !== 'string') throw new Error('OIDC state mismatch')
  const issuer = required('OIDC_ISSUER').replace(/\/$/, ''), client = required('OIDC_CLIENT_ID')
  const meta = await fetch(`${issuer}/.well-known/openid-configuration`).then(r => r.json()) as { token_endpoint:string; jwks_uri:string; issuer:string }
  const response = await fetch(meta.token_endpoint, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ grant_type:'authorization_code', code, redirect_uri:`${appUrl()}/auth/callback`, client_id:client, client_secret:required('OIDC_CLIENT_SECRET') }) })
  if (!response.ok) throw new Error(`OIDC token exchange failed: ${response.status}`)
  const data = await response.json() as { id_token?: string }
  if (!data.id_token) throw new Error('OIDC response has no ID token')
  const jwks = createRemoteJWKSet(new URL(meta.jwks_uri))
  const { payload } = await jwtVerify(data.id_token, jwks, { issuer:meta.issuer, audience:client })
  if (payload.nonce !== flow.nonce || typeof payload.sub !== 'string') throw new Error('OIDC token nonce or subject invalid')
  const name = typeof payload.name === 'string' ? payload.name : typeof payload.preferred_username === 'string' ? payload.preferred_username : payload.sub
  const session = await new SignJWT({ name }).setProtectedHeader({ alg:'HS256' }).setIssuer(appUrl()).setSubject(payload.sub).setIssuedAt().setExpirationTime('7d').sign(secret())
  const sessionCookie = `${cookieName}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
  setResponseHeader('Set-Cookie', [`microsns_oidc=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`, sessionCookie])
  return { sub: payload.sub, name }
}
export function logout() { setCookie('', 0) }
function required(key:string) { const v=process.env[key]; if (!v) throw new Error(`${key} is required`); return v }
function appUrl() { return required('APP_URL').replace(/\/$/, '') }
