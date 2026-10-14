import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { cookies } from 'next/headers';
import { db } from './db';

const SESSION = 'micro_session';
const FLOW = 'oidc_flow';
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || process.env.OIDC_CLIENT_SECRET || 'development-only-change-this-secret');
export type User = { sub: string; name: string };

export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION)?.value;
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, secret()); return payload.sub && typeof payload.name === 'string' ? { sub: payload.sub, name: payload.name } : null; }
  catch { return null; }
}
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}
export async function setSession(user: User) {
  const value = await new SignJWT({ name: user.name }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.sub).setIssuedAt().setExpirationTime('7d').sign(secret());
  (await cookies()).set(SESSION, value, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 604800 });
}
export async function clearSession() { (await cookies()).delete(SESSION); }
export async function setFlow(value: string) { (await cookies()).set(FLOW, value, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 }); }
export async function getFlow() { return (await cookies()).get(FLOW)?.value; }
export async function clearFlow() { (await cookies()).delete(FLOW); }
export async function verifyIdToken(token: string, nonce: string, issuer: string, clientId: string, jwksUri: string) {
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: clientId });
  if (payload.nonce !== nonce || typeof payload.sub !== 'string') throw new Error('Invalid ID token nonce or subject');
  return { sub: payload.sub, name: typeof payload.name === 'string' ? payload.name : (typeof payload.preferred_username === 'string' ? payload.preferred_username : payload.sub) };
}
export function saveUser(user: User) {
  db.prepare(`INSERT INTO users(sub,name,updated_at) VALUES(?,?,?) ON CONFLICT(sub) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`).run(user.sub, user.name, new Date().toISOString());
}
