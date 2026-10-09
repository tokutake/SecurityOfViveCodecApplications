import { readFile } from 'node:fs/promises';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from './auth.js';
import { HttpError, readJson, sendJson } from './http.js';
import { LlmError, generatePost } from './llm.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import {
  MAX_POST_LENGTH,
  MODELS,
  parseApiKey,
  parseBoolean,
  parseDisplayName,
  parseInstruction,
  parseModelId,
  parsePassword,
  parsePostBody,
  parseUsername,
  truncateCodePoints,
} from './validation.js';

const SESSION_COOKIE = 'sns_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMELINE_LIMIT = 100;
const PUBLIC_DIR = new URL('../public/', import.meta.url);
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'",
};

const now = () => new Date().toISOString();

function parseId(text) {
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, '見つかりません');
  return id;
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.includes('='))
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function toUser(row) {
  return { id: row.id, username: row.username, role: row.role, suspended: row.suspended === 1 };
}

function toAccount(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    modelId: row.model_id,
    instruction: row.instruction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPost(row, viewer) {
  const isLlm = row.author_type === 'llm';
  return {
    id: row.id,
    body: row.body,
    authorType: row.author_type,
    authorName: isLlm ? row.llm_name : row.username,
    modelId: row.model_id,
    createdAt: row.created_at,
    canDelete: viewer.role === 'admin' || row.user_id === viewer.id,
  };
}

// アプリ本体。テストでも同じものを使えるよう、DBと鍵と接続先を引数で受け取る。
export function createApp({ db, secret, openRouterBaseUrl, fetchImpl = fetch }) {
  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare(
      'INSERT INTO users (username, password_hash, role, suspended, created_at) VALUES (?, ?, ?, 0, ?)',
    ),
    listUsers: db.prepare('SELECT id, username, role, suspended, created_at FROM users ORDER BY id'),
    setSuspended: db.prepare('UPDATE users SET suspended = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionByHash: db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    upsertApiKey: db.prepare(`
      INSERT INTO api_keys (user_id, iv, tag, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at
    `),
    apiKeyByUser: db.prepare('SELECT iv, tag, ciphertext, updated_at FROM api_keys WHERE user_id = ?'),
    deleteApiKey: db.prepare('DELETE FROM api_keys WHERE user_id = ?'),
    insertAccount: db.prepare(
      'INSERT INTO llm_accounts (owner_id, display_name, model_id, instruction, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    accountsByOwner: db.prepare('SELECT * FROM llm_accounts WHERE owner_id = ? ORDER BY id'),
    accountById: db.prepare('SELECT * FROM llm_accounts WHERE id = ?'),
    updateAccount: db.prepare(
      'UPDATE llm_accounts SET display_name = ?, model_id = ?, instruction = ?, updated_at = ? WHERE id = ?',
    ),
    insertPost: db.prepare(
      'INSERT INTO posts (body, author_type, user_id, llm_account_id, model_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    postById: db.prepare('SELECT user_id FROM posts WHERE id = ?'),
    postViewById: db.prepare(`
      SELECT p.*, u.username, l.display_name AS llm_name
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN llm_accounts l ON l.id = p.llm_account_id
      WHERE p.id = ?
    `),
    timeline: db.prepare(`
      SELECT p.*, u.username, l.display_name AS llm_name
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN llm_accounts l ON l.id = p.llm_account_id
      ORDER BY p.id DESC
      LIMIT ?
    `),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
  };

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const hash = hashToken(token);
    const session = q.sessionByHash.get(hash);
    if (!session) return null;
    if (session.expires_at < Date.now()) {
      q.deleteSession.run(hash);
      return null;
    }
    const row = q.userById.get(session.user_id);
    return row ? toUser(row) : null;
  }

  function sessionCookie(userId) {
    const token = newSessionToken();
    q.deleteExpiredSessions.run(Date.now());
    q.insertSession.run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
  }

  function ownedAccount(idText, user) {
    const row = q.accountById.get(parseId(idText));
    if (!row) throw new HttpError(404, 'LLMアカウントが見つかりません');
    if (row.owner_id !== user.id) {
      throw new HttpError(403, '他の利用者のLLMアカウントは操作できません');
    }
    return row;
  }

  function requireActive(user) {
    if (user.suspended) throw new HttpError(403, '利用停止中のため投稿できません');
  }

  const routes = [];
  // auth: 'none' | 'user' | 'admin'
  const route = (method, pattern, auth, handler) => routes.push({ method, pattern, auth, handler });

  // --- 認証 ---
  route('POST', /^\/api\/auth\/register$/, 'none', async ({ body }) => {
    const username = parseUsername(body.username);
    const password = parsePassword(body.password);
    if (q.userByName.get(username)) throw new HttpError(409, 'そのユーザー名は使用されています');
    const info = q.insertUser.run(username, await hashPassword(password), 'user', now());
    const user = toUser(q.userById.get(info.lastInsertRowid));
    return {
      status: 201,
      data: { user },
      headers: { 'Set-Cookie': sessionCookie(user.id) },
    };
  });

  route('POST', /^\/api\/auth\/login$/, 'none', async ({ body }) => {
    const row = typeof body.username === 'string' ? q.userByName.get(body.username) : undefined;
    const ok =
      row && typeof body.password === 'string' && (await verifyPassword(body.password, row.password_hash));
    if (!ok) throw new HttpError(401, 'ユーザー名またはパスワードが違います');
    return { data: { user: toUser(row) }, headers: { 'Set-Cookie': sessionCookie(row.id) } };
  });

  route('POST', /^\/api\/auth\/logout$/, 'none', async ({ req }) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) q.deleteSession.run(hashToken(token));
    return {
      status: 204,
      headers: { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` },
    };
  });

  route('GET', /^\/api\/auth\/me$/, 'none', async ({ req }) => ({
    data: { user: currentUser(req) },
  }));

  route('GET', /^\/api\/models$/, 'none', async () => ({ data: { models: MODELS } }));

  // --- タイムラインと投稿 ---
  route('GET', /^\/api\/timeline$/, 'user', async ({ user }) => ({
    data: { posts: q.timeline.all(TIMELINE_LIMIT).map((row) => toPost(row, user)) },
  }));

  route('POST', /^\/api\/posts$/, 'user', async ({ user, body }) => {
    requireActive(user);
    const text = parsePostBody(body.body);
    const id = q.insertPost.run(text, 'human', user.id, null, null, now()).lastInsertRowid;
    return { status: 201, data: { post: toPost(q.postViewById.get(id), user) } };
  });

  route('DELETE', /^\/api\/posts\/([^/]+)$/, 'user', async ({ user, params }) => {
    const id = parseId(params[0]);
    const row = q.postById.get(id);
    if (!row) throw new HttpError(404, '投稿が見つかりません');
    if (user.role !== 'admin' && row.user_id !== user.id) {
      throw new HttpError(403, '自分の投稿以外は削除できません');
    }
    q.deletePost.run(id);
    return { status: 204 };
  });

  // --- OpenRouter APIキー（保存済みの値は返さない） ---
  route('GET', /^\/api\/me\/api-key$/, 'user', async ({ user }) => {
    const row = q.apiKeyByUser.get(user.id);
    return { data: { registered: Boolean(row), updatedAt: row?.updated_at ?? null } };
  });

  route('PUT', /^\/api\/me\/api-key$/, 'user', async ({ user, body }) => {
    const apiKey = parseApiKey(body.apiKey);
    const { iv, tag, ciphertext } = encryptSecret(secret, apiKey);
    const updatedAt = now();
    q.upsertApiKey.run(user.id, iv, tag, ciphertext, updatedAt);
    return { data: { registered: true, updatedAt } };
  });

  route('DELETE', /^\/api\/me\/api-key$/, 'user', async ({ user }) => {
    q.deleteApiKey.run(user.id);
    return { status: 204 };
  });

  // --- LLMアカウント（所有者のみ操作可） ---
  route('GET', /^\/api\/llm-accounts$/, 'user', async ({ user }) => ({
    data: { accounts: q.accountsByOwner.all(user.id).map(toAccount) },
  }));

  route('POST', /^\/api\/llm-accounts$/, 'user', async ({ user, body }) => {
    const displayName = parseDisplayName(body.displayName);
    const modelId = parseModelId(body.modelId);
    const instruction = parseInstruction(body.instruction);
    const timestamp = now();
    const id = q.insertAccount.run(user.id, displayName, modelId, instruction, timestamp, timestamp)
      .lastInsertRowid;
    return { status: 201, data: { account: toAccount(q.accountById.get(id)) } };
  });

  route('PATCH', /^\/api\/llm-accounts\/([^/]+)$/, 'user', async ({ user, params, body }) => {
    const row = ownedAccount(params[0], user);
    const displayName =
      body.displayName === undefined ? row.display_name : parseDisplayName(body.displayName);
    const modelId = body.modelId === undefined ? row.model_id : parseModelId(body.modelId);
    const instruction =
      body.instruction === undefined ? row.instruction : parseInstruction(body.instruction);
    q.updateAccount.run(displayName, modelId, instruction, now(), row.id);
    return { data: { account: toAccount(q.accountById.get(row.id)) } };
  });

  // 所有者のAPIキーと設定モデルで1件生成し、共有タイムラインに追加する。
  route('POST', /^\/api\/llm-accounts\/([^/]+)\/generate$/, 'user', async ({ user, params }) => {
    const account = ownedAccount(params[0], user);
    requireActive(user);
    const keyRow = q.apiKeyByUser.get(user.id);
    if (!keyRow) throw new HttpError(400, 'OpenRouter APIキーを先に登録してください');

    let text;
    try {
      text = await generatePost({
        baseUrl: openRouterBaseUrl,
        apiKey: decryptSecret(secret, keyRow),
        model: account.model_id,
        instruction: account.instruction,
        fetchImpl,
      });
    } catch (err) {
      if (err instanceof LlmError) throw new HttpError(502, err.message);
      throw err;
    }

    const body = truncateCodePoints(text, MAX_POST_LENGTH);
    const id = q.insertPost.run(body, 'llm', user.id, account.id, account.model_id, now()).lastInsertRowid;
    return { status: 201, data: { post: toPost(q.postViewById.get(id), user) } };
  });

  // --- 管理者 ---
  route('GET', /^\/api\/admin\/users$/, 'admin', async () => ({
    data: {
      users: q.listUsers.all().map((row) => ({
        id: row.id,
        username: row.username,
        role: row.role,
        suspended: row.suspended === 1,
        createdAt: row.created_at,
      })),
    },
  }));

  route('POST', /^\/api\/admin\/users\/([^/]+)\/suspension$/, 'admin', async ({ params, body }) => {
    const target = q.userById.get(parseId(params[0]));
    if (!target) throw new HttpError(404, 'ユーザーが見つかりません');
    if (target.role === 'admin') throw new HttpError(400, '管理者は利用停止にできません');
    const suspended = parseBoolean(body.suspended, 'suspended');
    q.setSuspended.run(suspended ? 1 : 0, target.id);
    return { data: { user: toUser(q.userById.get(target.id)) } };
  });

  async function serveStatic(res, pathname) {
    const [file, type] = STATIC_FILES[pathname];
    const content = await readFile(new URL(file, PUBLIC_DIR));
    res.writeHead(200, { 'Content-Type': type, ...SECURITY_HEADERS });
    res.end(content);
  }

  async function dispatch(req, res, url) {
    let pathMatched = false;
    for (const r of routes) {
      const match = url.pathname.match(r.pattern);
      if (!match) continue;
      if (r.method !== req.method) {
        pathMatched = true;
        continue;
      }

      const ctx = { req, params: match.slice(1).map(decodeURIComponent), user: null };
      if (r.auth !== 'none') {
        ctx.user = currentUser(req);
        if (!ctx.user) throw new HttpError(401, 'ログインしてください');
        if (r.auth === 'admin' && ctx.user.role !== 'admin') {
          throw new HttpError(403, '管理者のみ利用できます');
        }
      }
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        ctx.body = await readJson(req);
      }

      const result = (await r.handler(ctx)) ?? {};
      const { status = 200, data, headers = {} } = result;
      if (status === 204) {
        res.writeHead(204, headers);
        return res.end();
      }
      return sendJson(res, status, data, headers);
    }
    if (pathMatched) throw new HttpError(405, '許可されていないメソッドです');
    throw new HttpError(404, '見つかりません');
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && STATIC_FILES[url.pathname]) {
        return await serveStatic(res, url.pathname);
      }
      return await dispatch(req, res, url);
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message });
      }
      console.error(err);
      return sendJson(res, 500, { error: 'サーバー内部でエラーが発生しました' });
    }
  };
}
