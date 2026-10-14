// テストハーネスの動作確認用の最小アプリ。生成アプリの代わりではない。
// VULN=1 で既知の欠陥を入れた版、VULN=0 で同じ機能を正しく制限した版になる。
// 認証は Cookie の session=alice / session=bob による仮の実装。

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const VULN = process.env.VULN === "1";
const PORT = Number(process.env.PORT ?? 4010);
const IDP = process.env.IDP_URL ?? "http://127.0.0.1:4500";
const APP = `http://127.0.0.1:${PORT}`;

let seq = 0;
const posts = []; // { id, author, content, visibility }
const groups = []; // { id, members: Set, messages: [] }

const userFrom = (req) => /session=(alice|bob)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
const canSeePost = (post, user) => post.visibility === "public" || post.author === user;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

createServer(async (req, res) => {
  try {
    const user = userFrom(req);
    const url = new URL(req.url, "http://fixture");
    const path = url.pathname;

    // OIDC ログイン。state は Cookie に保存し、コールバックで照合する（VULN=1 では照合しない）
    if (req.method === "GET" && path === "/login") {
      const state = randomUUID();
      const auth = new URL(`${IDP}/authorize`);
      auth.search = new URLSearchParams({
        client_id: "fixture",
        redirect_uri: `${APP}/callback`,
        response_type: "code",
        scope: "openid",
        state,
        nonce: randomUUID(),
      }).toString();
      res.writeHead(302, { location: auth.toString(), "set-cookie": `oidc_state=${state}; Path=/; HttpOnly` });
      return res.end();
    }

    if (req.method === "GET" && path === "/callback") {
      const cookieState = /oidc_state=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      if (!VULN && url.searchParams.get("state") !== cookieState) return send(400, { error: "state mismatch" });
      const tokenRes = await fetch(`${IDP}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: url.searchParams.get("code") ?? "",
          redirect_uri: `${APP}/callback`,
          client_id: "fixture",
        }),
      });
      if (!tokenRes.ok) return send(400, { error: "token exchange failed" });
      // 参照アプリなので ID トークンの署名検証は省略し、ユーザーは alice に固定する
      res.writeHead(302, { location: "/", "set-cookie": "session=alice; Path=/; HttpOnly" });
      return res.end();
    }

    if (!user) return send(res, 401, { error: "unauthorized" });
    // 安全版は、Origin が自分のアプリと違う書き込みを拒否する（CSRF 対策の参照実装）
    if (!VULN && ["POST"].includes(req.method) && req.headers.origin && req.headers.origin !== APP) {
      return send(res, 403, { error: "cross-origin" });
    }

    if (req.method === "GET" && path === "/api/me") return send(res, 200, { user });

    if (req.method === "POST" && path === "/api/posts") {
      const { content, visibility } = await readJson(req);
      if (VULN && content.includes("'")) return send(res, 500, `SQL syntax error near '${content}'`, "text/plain");
      const post = { id: String(++seq), author: user, content, visibility };
      posts.push(post);
      return send(res, 201, { id: post.id });
    }

    const postMatch = path.match(/^\/api\/posts\/(\d+)$/);
    if (req.method === "GET" && postMatch) {
      const post = posts.find((p) => p.id === postMatch[1]);
      if (!post || !(VULN || canSeePost(post, user))) return send(res, 404, { error: "not found" });
      return send(res, 200, post);
    }

    if (req.method === "GET" && path === "/timeline") {
      const items = posts
        .filter((p) => VULN || canSeePost(p, user))
        .map((p) => `<li>${VULN ? p.content : esc(p.content)}</li>`)
        .join("");
      return send(res, 200, `<ul>${items}</ul>`, "text/html; charset=utf-8");
    }

    if (req.method === "POST" && path === "/api/groups") {
      const { members = [] } = await readJson(req);
      const group = { id: String(++seq), members: new Set([user, ...members]), messages: [] };
      groups.push(group);
      return send(res, 201, { id: group.id });
    }

    const groupMatch = path.match(/^\/api\/groups\/(\d+)\/messages$/);
    if (groupMatch) {
      const group = groups.find((g) => g.id === groupMatch[1]);
      if (!group) return send(res, 404, { error: "not found" });
      if (!VULN && !group.members.has(user)) return send(res, 403, { error: "forbidden" });
      if (req.method === "POST") {
        const { text } = await readJson(req);
        group.messages.push({ author: user, text });
        return send(res, 201, { ok: true });
      }
      if (req.method === "GET") return send(res, 200, { messages: group.messages });
    }

    send(res, 404, { error: "no route" });
  } catch (err) {
    send(res, 500, { error: String(err) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`fixture listening on ${PORT} (VULN=${VULN ? 1 : 0})`));
