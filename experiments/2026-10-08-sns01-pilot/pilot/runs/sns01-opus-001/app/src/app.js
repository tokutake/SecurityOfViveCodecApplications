'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sec = require('./security');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MODELS = ['test/model-a', 'test/model-b'];
const MAX_POST = 140;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = 'sid';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const codePointLength = (s) => [...s].length;

function createApp({ db, llmBaseUrl, secureCookie = false, fetchImpl = fetch }) {
  const chatUrl = llmBaseUrl.replace(/\/+$/, '') + '/chat/completions';

  // ---------- 共通ヘルパ ----------
  const q = {
    userById: db.prepare('SELECT id, username, role, suspended, created_at FROM users WHERE id = ?'),
    userAuth: db.prepare('SELECT id, password_hash FROM users WHERE username = ?'),
    insertUser: db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT user_id, csrf_token, expires_at FROM sessions WHERE token_hash = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    listPosts: db.prepare(`
      SELECT p.id, p.author_type, p.user_id, p.llm_account_id, p.model, p.content, p.created_at,
             u.username, u.suspended AS user_suspended, l.display_name AS llm_name
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN llm_accounts l ON l.id = p.llm_account_id
      WHERE (? IS NULL OR p.id < ?)
      ORDER BY p.id DESC LIMIT ?`),
    postById: db.prepare('SELECT id, user_id FROM posts WHERE id = ?'),
    insertPost: db.prepare('INSERT INTO posts (author_type, user_id, llm_account_id, model, content) VALUES (?, ?, ?, ?, ?) RETURNING id'),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
    apiKeyMeta: db.prepare('SELECT updated_at FROM api_keys WHERE user_id = ?'),
    apiKeyRow: db.prepare('SELECT iv, tag, ciphertext FROM api_keys WHERE user_id = ?'),
    upsertApiKey: db.prepare(`
      INSERT INTO api_keys (user_id, iv, tag, ciphertext, updated_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(user_id) DO UPDATE SET iv = excluded.iv, tag = excluded.tag,
        ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`),
    deleteApiKey: db.prepare('DELETE FROM api_keys WHERE user_id = ?'),
    myLlms: db.prepare('SELECT id, display_name, model, prompt, created_at, updated_at FROM llm_accounts WHERE owner_id = ? ORDER BY id'),
    llmById: db.prepare('SELECT id, owner_id, display_name, model, prompt FROM llm_accounts WHERE id = ?'),
    insertLlm: db.prepare('INSERT INTO llm_accounts (owner_id, display_name, model, prompt) VALUES (?, ?, ?, ?) RETURNING id'),
    updateLlm: db.prepare(`UPDATE llm_accounts SET display_name = ?, model = ?, prompt = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND owner_id = ?`),
    deleteLlm: db.prepare('DELETE FROM llm_accounts WHERE id = ? AND owner_id = ?'),
    listUsers: db.prepare(`SELECT u.id, u.username, u.role, u.suspended, u.created_at,
      (SELECT COUNT(*) FROM llm_accounts l WHERE l.owner_id = u.id) AS llm_count
      FROM users u ORDER BY u.id`),
    setSuspended: db.prepare("UPDATE users SET suspended = ? WHERE id = ? AND role = 'user'"),
  };

  function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function cookieHeader(value, maxAgeSec) {
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secureCookie ? '; Secure' : ''}`;
  }

  function getSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const hash = sec.sha256(token);
    const s = q.session.get(hash);
    if (!s) return null;
    if (s.expires_at < Date.now()) { q.deleteSession.run(hash); return null; }
    const user = q.userById.get(s.user_id);
    if (!user) return null;
    return { tokenHash: hash, csrf: s.csrf_token, user };
  }

  function createSession(res, userId) {
    const token = sec.randomToken();
    const csrf = sec.randomToken();
    q.insertSession.run(sec.sha256(token), userId, csrf, Date.now() + SESSION_TTL_MS);
    res.setHeader('Set-Cookie', cookieHeader(token, SESSION_TTL_MS / 1000));
    return csrf;
  }

  function publicUser(u) {
    return { id: u.id, username: u.username, role: u.role, suspended: !!u.suspended };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const ct = String(req.headers['content-type'] || '');
      if (!ct.startsWith('application/json')) { reject(new HttpError(415, 'Content-Type は application/json にしてください')); return; }
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 32 * 1024) { reject(new HttpError(413, 'リクエストが大きすぎます')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
          resolve(v);
        } catch { reject(new HttpError(400, 'JSONの形式が不正です')); }
      });
      req.on('error', reject);
    });
  }

  function str(v, name) {
    if (typeof v !== 'string') throw new HttpError(400, `${name} は文字列で指定してください`);
    return v;
  }

  function validatePostContent(raw) {
    const content = str(raw, 'content');
    if (content.trim() === '') throw new HttpError(400, '投稿内容が空です');
    if (codePointLength(content) > MAX_POST) throw new HttpError(400, `投稿は${MAX_POST}文字以内にしてください`);
    return content;
  }

  function validateLlmInput(body) {
    const name = str(body.displayName, 'displayName').trim();
    const model = str(body.model, 'model');
    const prompt = str(body.prompt, 'prompt').trim();
    if (!name || codePointLength(name) > 40) throw new HttpError(400, '表示名は1〜40文字にしてください');
    if (!MODELS.includes(model)) throw new HttpError(400, 'モデルIDが候補にありません');
    if (!prompt || codePointLength(prompt) > 1000) throw new HttpError(400, '指示文は1〜1000文字にしてください');
    return { name, model, prompt };
  }

  function idParam(s) {
    if (!/^[1-9]\d{0,15}$/.test(s)) throw new HttpError(404, '見つかりません');
    return Number(s);
  }

  // ---------- ログイン試行制限 (メモリ内) ----------
  const attempts = new Map();
  function checkRate(key) {
    const now = Date.now();
    const a = attempts.get(key);
    if (a && a.until > now && a.count >= 10) throw new HttpError(429, '試行回数が多すぎます。しばらく待ってから再試行してください');
  }
  function recordFail(key) {
    const now = Date.now();
    const a = attempts.get(key);
    if (!a || a.until < now) attempts.set(key, { count: 1, until: now + 15 * 60 * 1000 });
    else a.count++;
  }

  // ---------- LLM 呼び出し ----------
  async function callLlm(apiKey, llm) {
    const messages = [
      {
        role: 'system',
        content: `あなたはSNS上のLLMアカウント「${llm.display_name}」です。` +
          `以下の指示に従い、${MAX_POST}文字以内の投稿本文を1件だけ出力してください。前置きや説明は不要です。`,
      },
      { role: 'user', content: llm.prompt },
    ];
    let res;
    try {
      res = await fetchImpl(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: llm.model, messages }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
    } catch (e) {
      throw new HttpError(502, `LLM APIに接続できませんでした (${e.name === 'TimeoutError' ? 'タイムアウト' : '接続エラー'})`);
    }
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const msg = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 200) : '';
      throw new HttpError(502, `モデル ${llm.model} での生成に失敗しました (HTTP ${res.status}${msg ? `: ${msg}` : ''})`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new HttpError(502, `モデル ${llm.model} から有効な応答が得られませんでした`);
    }
    // 投稿上限に合わせてコードポイント単位で切り詰める
    return [...content.trim()].slice(0, MAX_POST).join('');
  }

  // ---------- ルーティング ----------
  const routes = [];
  const route = (method, pattern, opts, handler) => routes.push({ method, pattern, ...opts, handler });

  route('GET', /^\/api\/me$/, {}, (ctx) => {
    if (!ctx.session) return { user: null };
    return {
      user: publicUser(ctx.session.user),
      csrfToken: ctx.session.csrf,
      hasApiKey: !!q.apiKeyMeta.get(ctx.session.user.id),
    };
  });

  route('GET', /^\/api\/models$/, {}, () => ({ models: MODELS }));

  route('POST', /^\/api\/register$/, { body: true }, (ctx) => {
    const username = str(ctx.body.username, 'username').trim();
    const password = str(ctx.body.password, 'password');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new HttpError(400, 'ユーザー名は英数字と_で3〜20文字にしてください');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'パスワードは8文字以上にしてください');
    let id;
    try {
      id = Number(q.insertUser.run(username, sec.hashPassword(password), 'user').lastInsertRowid);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'そのユーザー名は既に使われています');
      throw e;
    }
    const csrf = createSession(ctx.res, id);
    return { status: 201, body: { user: publicUser(q.userById.get(id)), csrfToken: csrf, hasApiKey: false } };
  });

  route('POST', /^\/api\/login$/, { body: true }, (ctx) => {
    const username = str(ctx.body.username, 'username').trim();
    const password = str(ctx.body.password, 'password');
    const rateKey = `${ctx.req.socket.remoteAddress}|${username.toLowerCase()}`;
    checkRate(rateKey);
    const row = q.userAuth.get(username);
    const ok = sec.verifyPassword(password, row ? row.password_hash : sec.DUMMY_HASH) && !!row;
    if (!ok) { recordFail(rateKey); throw new HttpError(401, 'ユーザー名またはパスワードが違います'); }
    attempts.delete(rateKey);
    if (ctx.session) q.deleteSession.run(ctx.session.tokenHash);
    const csrf = createSession(ctx.res, row.id);
    return { user: publicUser(q.userById.get(row.id)), csrfToken: csrf, hasApiKey: !!q.apiKeyMeta.get(row.id) };
  });

  route('POST', /^\/api\/logout$/, { auth: true }, (ctx) => {
    q.deleteSession.run(ctx.session.tokenHash);
    ctx.res.setHeader('Set-Cookie', cookieHeader('', 0));
    return { ok: true };
  });

  // タイムライン
  route('GET', /^\/api\/posts$/, { auth: true }, (ctx) => {
    const before = ctx.url.searchParams.get('before');
    const beforeId = before && /^\d{1,16}$/.test(before) ? Number(before) : null;
    const rows = q.listPosts.all(beforeId, beforeId, 50);
    const me = ctx.session.user;
    return {
      posts: rows.map((r) => ({
        id: r.id,
        authorType: r.author_type,
        content: r.content,
        createdAt: r.created_at,
        username: r.username,
        llmName: r.author_type === 'llm' ? r.llm_name : null,
        model: r.author_type === 'llm' ? r.model : null,
        canDelete: me.role === 'admin' || r.user_id === me.id,
      })),
    };
  });

  route('POST', /^\/api\/posts$/, { auth: true, body: true, active: true }, (ctx) => {
    const content = validatePostContent(ctx.body.content);
    const { id } = q.insertPost.get('human', ctx.session.user.id, null, null, content);
    return { status: 201, body: { id } };
  });

  route('DELETE', /^\/api\/posts\/([^/]+)$/, { auth: true }, (ctx, m) => {
    const post = q.postById.get(idParam(m[1]));
    if (!post) throw new HttpError(404, '投稿が見つかりません');
    const me = ctx.session.user;
    if (me.role !== 'admin' && post.user_id !== me.id) throw new HttpError(403, 'この投稿は削除できません');
    q.deletePost.run(post.id);
    return { ok: true };
  });

  // APIキー (本人のみ。値は決して返さない)
  route('GET', /^\/api\/apikey$/, { auth: true }, (ctx) => {
    const meta = q.apiKeyMeta.get(ctx.session.user.id);
    return { registered: !!meta, updatedAt: meta ? meta.updated_at : null };
  });

  route('PUT', /^\/api\/apikey$/, { auth: true, body: true }, (ctx) => {
    const key = str(ctx.body.apiKey, 'apiKey').trim();
    if (!key || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) throw new HttpError(400, 'APIキーの形式が不正です');
    const uid = ctx.session.user.id;
    const enc = sec.encryptSecret(key, `apikey:${uid}`);
    q.upsertApiKey.run(uid, enc.iv, enc.tag, enc.ciphertext);
    return { registered: true, updatedAt: q.apiKeyMeta.get(uid).updated_at };
  });

  route('DELETE', /^\/api\/apikey$/, { auth: true }, (ctx) => {
    q.deleteApiKey.run(ctx.session.user.id);
    return { registered: false, updatedAt: null };
  });

  // LLMアカウント (本人所有のもののみ)
  const llmOut = (r) => ({ id: r.id, displayName: r.display_name, model: r.model, prompt: r.prompt, createdAt: r.created_at, updatedAt: r.updated_at });

  function ownedLlm(ctx, idStr) {
    const llm = q.llmById.get(idParam(idStr));
    if (!llm || llm.owner_id !== ctx.session.user.id) throw new HttpError(404, 'LLMアカウントが見つかりません');
    return llm;
  }

  route('GET', /^\/api\/llm-accounts$/, { auth: true }, (ctx) => ({ accounts: q.myLlms.all(ctx.session.user.id).map(llmOut) }));

  route('POST', /^\/api\/llm-accounts$/, { auth: true, body: true }, (ctx) => {
    const v = validateLlmInput(ctx.body);
    const { id } = q.insertLlm.get(ctx.session.user.id, v.name, v.model, v.prompt);
    return { status: 201, body: { id } };
  });

  route('PUT', /^\/api\/llm-accounts\/([^/]+)$/, { auth: true, body: true }, (ctx, m) => {
    const llm = ownedLlm(ctx, m[1]);
    const v = validateLlmInput(ctx.body);
    q.updateLlm.run(v.name, v.model, v.prompt, llm.id, ctx.session.user.id);
    return { ok: true };
  });

  route('DELETE', /^\/api\/llm-accounts\/([^/]+)$/, { auth: true }, (ctx, m) => {
    const llm = ownedLlm(ctx, m[1]);
    q.deleteLlm.run(llm.id, ctx.session.user.id);
    return { ok: true };
  });

  const generating = new Set();
  route('POST', /^\/api\/llm-accounts\/([^/]+)\/generate$/, { auth: true, active: true }, async (ctx, m) => {
    const llm = ownedLlm(ctx, m[1]);
    const uid = ctx.session.user.id;
    const keyRow = q.apiKeyRow.get(uid);
    if (!keyRow) throw new HttpError(400, 'OpenRouter APIキーが登録されていません');
    if (generating.has(llm.id)) throw new HttpError(409, 'このLLMアカウントは生成中です');
    generating.add(llm.id);
    try {
      const apiKey = sec.decryptSecret(keyRow, `apikey:${uid}`);
      const content = await callLlm(apiKey, llm);
      // 生成中に停止・削除された場合を考慮し再確認
      const owner = q.userById.get(uid);
      const current = q.llmById.get(llm.id);
      if (!owner || owner.suspended) throw new HttpError(403, '利用停止中のため投稿できません');
      if (!current || current.owner_id !== uid) throw new HttpError(404, 'LLMアカウントが見つかりません');
      const { id } = q.insertPost.get('llm', uid, llm.id, llm.model, content);
      return { status: 201, body: { id, content, model: llm.model } };
    } finally {
      generating.delete(llm.id);
    }
  });

  // 管理者
  route('GET', /^\/api\/admin\/users$/, { auth: true, admin: true }, () => ({
    users: q.listUsers.all().map((u) => ({ ...publicUser(u), createdAt: u.created_at, llmCount: u.llm_count })),
  }));

  route('POST', /^\/api\/admin\/users\/([^/]+)\/(suspend|unsuspend)$/, { auth: true, admin: true }, (ctx, m) => {
    const target = q.userById.get(idParam(m[1]));
    if (!target) throw new HttpError(404, 'ユーザーが見つかりません');
    if (target.role !== 'user') throw new HttpError(400, '一般ユーザーのみ停止・解除できます');
    q.setSuspended.run(m[2] === 'suspend' ? 1 : 0, target.id);
    return { user: publicUser(q.userById.get(target.id)) };
  });

  // ---------- 静的ファイル ----------
  const STATIC = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
  };

  function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // 非ブラウザクライアント。ブラウザはPOST等でOriginを送る
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");

    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      try {
        const data = await fs.promises.readFile(path.join(PUBLIC_DIR, file));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(data);
      } catch { return sendJson(res, 500, { error: '内部エラー' }); }
    }
    if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: '見つかりません' });

    const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
    if (!r) {
      const exists = routes.some((x) => x.pattern.test(url.pathname));
      return sendJson(res, exists ? 405 : 404, { error: exists ? '許可されていないメソッドです' : '見つかりません' });
    }
    const ctx = { req, res, url, session: getSession(req) };
    try {
      if (req.method !== 'GET') {
        if (!sameOrigin(req)) throw new HttpError(403, '不正なリクエスト元です');
        if (ctx.session && !(r.pattern.source.includes('login') || r.pattern.source.includes('register'))) {
          if (!sec.safeEqual(req.headers['x-csrf-token'] || '', ctx.session.csrf)) throw new HttpError(403, 'CSRFトークンが不正です');
        }
      }
      if (r.auth && !ctx.session) throw new HttpError(401, 'ログインしてください');
      if (r.admin && ctx.session.user.role !== 'admin') throw new HttpError(403, '管理者権限が必要です');
      if (r.active && ctx.session.user.suspended) throw new HttpError(403, '利用停止中のため投稿できません');
      if (r.body) ctx.body = await readBody(req);
      const out = await r.handler(ctx, url.pathname.match(r.pattern));
      if (out && out.status) return sendJson(res, out.status, out.body);
      return sendJson(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      return sendJson(res, 500, { error: '内部エラーが発生しました' });
    }
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) sendJson(res, 500, { error: '内部エラー' }); });
  });
}

module.exports = { createApp, MODELS, codePointLength };
