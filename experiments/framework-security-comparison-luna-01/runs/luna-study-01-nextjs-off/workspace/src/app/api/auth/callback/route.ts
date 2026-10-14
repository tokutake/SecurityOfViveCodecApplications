import { NextRequest, NextResponse } from 'next/server';
import { clearFlow, getFlow, saveUser, setSession, verifyIdToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    if (params.has('error')) throw new Error(params.get('error_description') || params.get('error') || 'OIDC login failed');
    const raw = await getFlow();
    if (!raw || params.get('state') === null) throw new Error('Invalid login state');
    const flow = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { state: string; nonce: string; verifier: string };
    if (params.get('state') !== flow.state || !params.get('code')) throw new Error('Invalid login state');
    const issuer = process.env.OIDC_ISSUER!, clientId = process.env.OIDC_CLIENT_ID!, clientSecret = process.env.OIDC_CLIENT_SECRET!, appUrl = process.env.APP_URL!;
    const discovery = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { cache: 'no-store' });
    if (!discovery.ok) throw new Error('OIDC discovery failed');
    const config = await discovery.json() as { token_endpoint: string; issuer: string; jwks_uri: string };
    if (config.issuer !== issuer.replace(/\/$/, '')) throw new Error('OIDC issuer mismatch');
    const tokenResponse = await fetch(config.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` }, body: new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code')!, redirect_uri: `${appUrl.replace(/\/$/, '')}/api/auth/callback`, code_verifier: flow.verifier }), cache: 'no-store' });
    const tokens = await tokenResponse.json() as { id_token?: string; error?: string };
    if (!tokenResponse.ok || !tokens.id_token) throw new Error(tokens.error || 'OIDC token exchange failed');
    const user = await verifyIdToken(tokens.id_token, flow.nonce, config.issuer, clientId, config.jwks_uri);
    saveUser(user); await setSession(user); await clearFlow();
    return NextResponse.redirect(new URL('/', appUrl));
  } catch (error) {
    await clearFlow();
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(message)}`, process.env.APP_URL || request.nextUrl.origin));
  }
}
