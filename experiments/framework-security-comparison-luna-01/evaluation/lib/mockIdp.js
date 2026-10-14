// テスト用の模擬IdP。OIDCの最小限のエンドポイントだけを持つ。
// /authorize は常に成功する（login_hint 省略時は alice）。認可コードは1回限り。
// 実在のプロバイダーや実キーは使わない。redirect_uri の登録照合は省略している。

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const b64url = (value) => Buffer.from(value).toString("base64url");

export function startMockIdp({ port, issuer, host = "127.0.0.1", control = false, tls }) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
  const codes = new Map(); // code -> { clientId, redirectUri, nonce, sub }
  const accessTokens = new Map(); // access_token -> sub（userinfo 用）
  let currentSub = "alice"; // login_hint がない認可で使うユーザー

  function signIdToken(claims) {
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
    const payload = b64url(JSON.stringify(claims));
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey, "base64url");
    return `${header}.${payload}.${signature}`;
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, issuer);
    // 常駐モードだけ: テスト側が、次にログインするユーザーを切り替える
    if (control && url.pathname === "/__set-sub") {
      currentSub = url.searchParams.get("sub") ?? currentSub;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ sub: currentSub }));
    }
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }

    if (url.pathname === "/jwks") return send(200, { keys: [jwk] });

    if (url.pathname === "/userinfo") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const sub = accessTokens.get(token);
      if (!sub) return send(401, { error: "invalid_token" });
      return send(200, { sub });
    }

    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      const code = randomUUID();
      codes.set(code, {
        clientId: p.get("client_id"),
        redirectUri: p.get("redirect_uri"),
        nonce: p.get("nonce"),
        sub: p.get("login_hint") ?? currentSub,
      });
      const back = new URL(p.get("redirect_uri"));
      back.searchParams.set("code", code);
      if (p.get("state")) back.searchParams.set("state", p.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const entry = codes.get(form.get("code"));
      codes.delete(form.get("code"));
      if (!entry || entry.redirectUri !== form.get("redirect_uri")) return send(400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      const idToken = signIdToken({
        iss: issuer,
        sub: entry.sub,
        aud: entry.clientId,
        iat: now,
        exp: now + 300,
        // nonce は認可リクエストで送られたときだけ入れる
        ...(entry.nonce ? { nonce: entry.nonce } : {}),
      });
      const accessToken = randomUUID();
      accessTokens.set(accessToken, entry.sub);
      return send(200, { token_type: "Bearer", expires_in: 300, access_token: accessToken, id_token: idToken });
    }

    send(404, { error: "not found" });
  };
  const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);

  return new Promise((resolve) => {
    server.listen(port, host, () =>
      resolve({
        issuer,
        setSub: (sub) => { currentSub = sub; },
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });
}

// 単体で起動する場合: node lib/mockIdp.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4500);
  const issuer = process.env.ISSUER ?? `http://127.0.0.1:${port}`;
  const tls = process.env.TLS_CERT && process.env.TLS_KEY
    ? { cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) }
    : undefined;
  const idp = await startMockIdp({ port, issuer, host: "0.0.0.0", control: true, tls });
  console.log(`mock IdP (常駐): ${idp.issuer}`);
}
