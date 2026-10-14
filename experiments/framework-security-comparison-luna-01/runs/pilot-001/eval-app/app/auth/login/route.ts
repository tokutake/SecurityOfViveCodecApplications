import { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { FLOW_COOKIE, cookieOptions, oidcConfig, redirectUri } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await oidcConfig();
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(),
    scope: "openid profile email",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(FLOW_COOKIE, JSON.stringify({ verifier, state, nonce }), cookieOptions(600));
  return res;
}
