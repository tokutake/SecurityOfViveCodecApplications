import { NextRequest, NextResponse } from "next/server";
import * as oidc from "openid-client";
import {
  FLOW_COOKIE,
  SESSION_COOKIE,
  appUrl,
  cookieOptions,
  createSession,
  oidcConfig,
  redirectUri,
  sessionMaxAgeSec,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function fail(message: string, status = 400) {
  const res = new NextResponse(message, { status });
  res.cookies.delete(FLOW_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const raw = req.cookies.get(FLOW_COOKIE)?.value;
  if (!raw) return fail("ログインセッションが見つかりません。最初からやり直してください。");
  let flow: { verifier: string; state: string; nonce: string };
  try {
    flow = JSON.parse(raw);
  } catch {
    return fail("ログインセッションが不正です。");
  }

  try {
    const config = await oidcConfig();
    // プロキシ配下でも一致するよう、APP_URL を基準に現在の URL を組み立てる
    const current = new URL(redirectUri());
    current.search = req.nextUrl.search;
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) return fail("ID トークンに sub がありません。");
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    let profile: Record<string, unknown> = claims;
    if (!str(claims.name) && !str(claims.preferred_username) && !str(claims.email)) {
      // ID トークンに表示名がない IdP 向けに userinfo を参照する（sub 一致を検証）
      try {
        profile = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
      } catch (e) {
        console.warn("userinfo の取得に失敗:", e);
      }
    }
    const displayName =
      str(profile.name) ?? str(profile.preferred_username) ?? str(profile.email) ?? claims.sub;

    const token = createSession(claims.sub, displayName.slice(0, 100));
    const res = NextResponse.redirect(new URL("/", appUrl()));
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(sessionMaxAgeSec()));
    res.cookies.delete(FLOW_COOKIE);
    return res;
  } catch (e) {
    console.error("OIDC callback error:", e);
    return fail("ログインに失敗しました。", 401);
  }
}
