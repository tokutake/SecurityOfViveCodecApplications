import { DatabaseSync } from 'node:sqlite'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databasePath = resolve(process.env.DATABASE_PATH || './data.sqlite')
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
const db = new DatabaseSync(databasePath)
chmodSync(databasePath, 0o600)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
db.exec(`CREATE TABLE IF NOT EXISTS users(sub TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, sub TEXT NOT NULL REFERENCES users(sub), body TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members(group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, sub TEXT NOT NULL REFERENCES users(sub), PRIMARY KEY(group_id,sub));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, sub TEXT NOT NULL REFERENCES users(sub), body TEXT NOT NULL, created INTEGER NOT NULL);`)

export const config = () => {
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, APP_URL } = process.env
  if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET || !APP_URL) throw new Error('OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and APP_URL are required')
  const app = new URL(APP_URL), issuer = new URL(OIDC_ISSUER)
  if ((app.protocol !== 'https:' && !(app.protocol === 'http:' && ['localhost','127.0.0.1'].includes(app.hostname))) || app.pathname !== '/' || app.search || app.hash) throw new Error('APP_URL must be an HTTPS origin (HTTP is allowed only for localhost)')
  if (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && ['localhost','127.0.0.1'].includes(issuer.hostname))) throw new Error('OIDC_ISSUER must use HTTPS')
  return { issuer: issuer.href.replace(/\/$/, ''), clientId: OIDC_CLIENT_ID, secret: OIDC_CLIENT_SECRET, appUrl: app.origin }
}
const sessionKey = (sid:string) => createHash('sha256').update(sid).digest('base64url')
const b64 = (x: Buffer) => x.toString('base64url')
const sign = (v: string) => createHmac('sha256', config().secret).update(v).digest('base64url')
export const cookie = (request: Request, name: string) => request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)
export const cookieHeader = (name:string,value:string,age:number,secure:boolean) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`
export const beginLogin = async () => {
  const c=config(), discovery=await fetch(`${c.issuer}/.well-known/openid-configuration`)
  if(!discovery.ok) throw new Error('OIDC discovery failed')
  const oidc=await discovery.json() as {authorization_endpoint:string}
  const state=b64(randomBytes(32)), verifier=b64(randomBytes(48)), nonce=b64(randomBytes(32))
  const payload=b64(Buffer.from(JSON.stringify({state,verifier,nonce,exp:Date.now()+600000})))
  const url=new URL(oidc.authorization_endpoint); url.searchParams.set('response_type','code'); url.searchParams.set('client_id',c.clientId); url.searchParams.set('redirect_uri',c.appUrl+'/auth/callback'); url.searchParams.set('scope','openid profile'); url.searchParams.set('state',state); url.searchParams.set('nonce',nonce)
  const challenge=b64(Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))); url.searchParams.set('code_challenge',challenge); url.searchParams.set('code_challenge_method','S256')
  return {url:url.toString(), stateCookie:payload+'.'+sign(payload)}
}
export async function callback(request:Request) {
  const c=config(), raw=cookie(request,'oidc_tx'); if(!raw) throw new Error('Missing OIDC transaction')
  const [payload,sig]=raw.split('.'); if(!payload||!sig||!timingSafeEqual(Buffer.from(sig),Buffer.from(sign(payload)))) throw new Error('Invalid OIDC transaction')
  const tx=JSON.parse(Buffer.from(payload,'base64url').toString()) as {state:string;verifier:string;nonce:string;exp:number}
  const current=new URL(request.url); const code=current.searchParams.get('code'), state=current.searchParams.get('state')
  if(!code||state!==tx.state||tx.exp<Date.now()) throw new Error('Invalid or expired OIDC response')
  const discovery=await fetch(`${c.issuer}/.well-known/openid-configuration`); if(!discovery.ok) throw new Error('OIDC discovery failed')
  const oidc=await discovery.json() as {token_endpoint:string;jwks_uri:string}
  const token=await fetch(oidc.token_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:c.appUrl+'/auth/callback',client_id:c.clientId,client_secret:c.secret,code_verifier:tx.verifier})})
  if(!token.ok) throw new Error('OIDC token exchange failed')
  const tokens=await token.json() as {id_token?:string}; if(!tokens.id_token) throw new Error('ID token missing')
  const {payload:claims}=await jwtVerify(tokens.id_token,createRemoteJWKSet(new URL(oidc.jwks_uri)),{issuer:c.issuer,audience:c.clientId})
  if(claims.nonce!==tx.nonce||typeof claims.sub!=='string') throw new Error('Invalid ID token')
  const sub=claims.sub, name=typeof claims.name==='string'?claims.name:(typeof claims.preferred_username==='string'?claims.preferred_username:sub)
  db.prepare('INSERT INTO users(sub,name) VALUES(?,?) ON CONFLICT(sub) DO UPDATE SET name=excluded.name').run(sub,name)
  const sid=b64(randomBytes(32)); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sessionKey(sid),sub,Date.now()+7*86400000)
  return sid
}
export function currentUser(request:Request) {
  const sid=cookie(request,'sid'); if(!sid) return null
  const row=db.prepare('SELECT users.sub,users.name FROM sessions JOIN users ON users.sub=sessions.sub WHERE sessions.id=? AND sessions.expires>?').get(sessionKey(sid),Date.now()) as {sub:string;name:string}|undefined
  return row||null
}
export { db }
