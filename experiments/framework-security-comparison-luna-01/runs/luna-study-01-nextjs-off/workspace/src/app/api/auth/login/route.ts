import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { setFlow } from '@/lib/auth';

export async function GET() {
  const issuer = process.env.OIDC_ISSUER, clientId = process.env.OIDC_CLIENT_ID, appUrl = process.env.APP_URL;
  if (!issuer || !clientId || !appUrl) return NextResponse.json({ error: 'OIDC_ISSUER、OIDC_CLIENT_ID、APP_URL を設定してください' }, { status: 503 });
  const discovery = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { cache: 'no-store' });
  if (!discovery.ok) return NextResponse.json({ error: 'OIDC discovery に失敗しました' }, { status: 502 });
  const config = await discovery.json() as { authorization_endpoint: string };
  const state = randomBytes(24).toString('base64url'), nonce = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  await setFlow(Buffer.from(JSON.stringify({ state, nonce, verifier })).toString('base64url'));
  const url = new URL(config.authorization_endpoint);
  url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', clientId); url.searchParams.set('redirect_uri', `${appUrl.replace(/\/$/, '')}/api/auth/callback`);
  url.searchParams.set('scope', 'openid profile'); url.searchParams.set('state', state); url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url')); url.searchParams.set('code_challenge_method', 'S256');
  return NextResponse.redirect(url);
}
