import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes, createHash, createCipheriv, createDecipheriv, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { createMock, MODELS } from './mock.js';

const scryptAsync = promisify(scrypt);
const here = dirname(fileURLToPath(import.meta.url));

export function createApp(env = process.env, { fetchImpl = fetch } = {}) {
  const port = Number(env.PORT || 3000);
  const dbPath = env.SNS_DB || join(here, 'data', 'sns.db');
  const db = openDb(dbPath);
  const mock = createMock({ failModels: (env.MOCK_FAIL_MODELS || '').split(',').filter(Boolean) });
  const upstreamBase = (env.OPENROUTER_BASE_URL || `http://127.0.0.1:${port}/mock`).replace(/\/+$/, '');

  // APIキー暗号化用のマスターキー（環境変数 or data/secret.key）
  const masterKey = (() => {
    if (env.SNS_SECRET_KEY) {
      const k = Buffer.from(env.SNS_SECRET_KEY, 'hex');
      if (k.length !== 32) throw new Error('SNS_SECRET_KEY は64桁の16進文字列にしてください');
      return k;
    }
    const f = join(dirname(dbPath === ':memory:' ? join(here, 'data', 'x') : dbPath), 'secret.key');
    if (!existsSync(f)) {
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    return Buffer.from(readFileSync(f, 'utf8').trim(), 'hex');
  })();

  const encrypt = (plain, userId) => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', masterKey, iv);
    c.setAAD(Buffer.from(String(userId)));
    const ciphertext = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return { iv, tag: c.getAuthTag(), ciphertext };
  };
  const decrypt = (row, userId) => {
    const d = createDecipheriv('aes-256-gcm', masterKey, row.iv);
    d.setAAD(Buffer.from(String(userId)));
    d.setAuthTag(row.tag);
    return Buffer.concat([d.update(row.ciphertext), d.final()]).toString('utf8');
  };

  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const hashPw = (pw, salt) => scryptAsync(pw, salt, 64);
  const DUMMY_SALT = randomBytes(16);

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const bad = (m) => new HttpError(400, m);
  const cpLen = (s) => [...s].length;

  // ---- ログイン試行制限（メモリ内） ----
  const fails = new Map();
  const throttled = (k) => { const f = fails.get(k); return f && f.until > Date.now() && f.n >= 10; };
  const noteFail = (k) => {
    const f = fails.get(k);
    if (!f || f.until < Date.now()) fails.set(k, { n: 1, until: Date.now() + 10 * 60_000 });
    else f.n++;
  };

  // ---- セッション ----
  const SESSION_MS = 7 * 24 * 3600_000;
  function createSession(res, userId) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
      .run(sha(token), userId, Date.now() + SESSION_MS);
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
  }
  const cookieToken = (req) => /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  function currentUser(req) {
    const t = cookieToken(req);
    if (!t) return null;
    return db.prepare(`SELECT u.id, u.username, u.is_admin, u.suspended FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha(t), Date.now()) || null;
  }
  const requireUser = (req) => {
    const u = currentUser(req);
    if (!u) throw new HttpError(401, 'ログインが必要です');
    return u;
  };
  const requireActive = (req) => {
    const u = requireUser(req);
    if (u.suspended) throw new HttpError(403, 'アカウントが利用停止中のため、この操作はできません');
    return u;
  };
  const requireAdmin = (req) => {
    const u = requireUser(req);
    if (!u.is_admin) throw new HttpError(403, '管理者権限が必要です');
    return u;
  };

  const publicUser = (u) => ({
    id: u.id, username: u.username, isAdmin: !!u.is_admin, suspended: !!u.suspended,
    hasApiKey: !!db.prepare('SELECT 1 FROM api_keys WHERE user_id = ?').get(u.id),
  });

  // ---- 入力検証 ----
  function validatePost(body) {
    if (typeof body !== 'string') throw bad('本文が不正です');
    const t = body.trim();
    if (!t) throw bad('投稿が空です');
    if (cpLen(t) > 140) throw bad('投稿は140文字以内にしてください');
    return t;
  }
  function validateLlm(b) {
    const name = typeof b.displayName === 'string' ? b.displayName.trim() : '';
    const instruction = typeof b.instruction === 'string' ? b.instruction.trim() : '';
    if (!name || cpLen(name) > 30) throw bad('表示名は1〜30文字で入力してください');
    if (!MODELS.includes(b.model)) throw bad('モデルIDが不正です');
    if (!instruction || cpLen(instruction) > 1000) throw bad('指示文は1〜1000文字で入力してください');
    return { name, model: b.model, instruction };
  }

  const llmRow = (r) => ({ id: r.id, displayName: r.display_name, model: r.model, instruction: r.instruction });
  const postRow = (r) => ({
    id: r.id, body: r.body, createdAt: r.created_at,
    author: r.llm_id
      ? { kind: 'llm', name: r.llm_name, model: r.llm_model, ownerId: r.llm_owner, ownerName: r.llm_owner_name }
      : { kind: 'human', name: r.username, userId: r.user_id },
  });
  const POST_SELECT = `SELECT p.*, u.username, l.display_name AS llm_name, l.model AS llm_model,
      l.owner_id AS llm_owner, o.username AS llm_owner_name
    FROM posts p LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN llm_accounts l ON l.id = p.llm_id LEFT JOIN users o ON o.id = l.owner_id`;

  // ---- 上流（OpenRouter互換）呼び出し ----
  async function callUpstream(apiKey, model, instruction) {
    let res;
    try {
      res = await fetchImpl(`${upstreamBase}/api/v1/chat/completions`, {
        method: 'POST',
        redirect: 'error', // Bearerキーを別ホストへ送らない
        signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: instruction },
            { role: 'user', content: '140文字以内で、SNSに投稿する短い文章を1件だけ書いてください。本文のみを出力してください。' },
          ],
        }),
      });
    } catch {
      throw new HttpError(502, `モデル ${model} への接続に失敗しました`);
    }
    const text = (await res.text()).slice(0, 65536);
    let data = null;
    try { data = JSON.parse(text); } catch { /* 下で処理 */ }
    if (!res.ok) {
      const msg = typeof data?.error?.message === 'string' ? `: ${data.error.message.slice(0, 100)}` : '';
      throw new HttpError(502, `モデル ${model} の生成に失敗しました (HTTP ${res.status})${msg}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new HttpError(502, `モデル ${model} から有効な応答がありませんでした`);
    return [...content.trim()].slice(0, 140).join('').trim();
  }

  // ---- ルート ----
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

  route('POST', '/api/register', async ({ body, res }) => {
    const { username, password } = body;
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username)) throw bad('ユーザー名は英数字とアンダースコアの3〜20文字にしてください');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw bad('パスワードは8〜200文字にしてください');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'このユーザー名は既に使われています');
    const salt = randomBytes(16);
    const r = db.prepare('INSERT INTO users (username, pass_salt, pass_hash, created_at) VALUES (?,?,?,?)')
      .run(username, salt, await hashPw(password, salt), Date.now());
    createSession(res, Number(r.lastInsertRowid));
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) };
  });

  route('POST', '/api/login', async ({ body, req, res }) => {
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string') throw bad('入力が不正です');
    const tk = `${req.socket.remoteAddress}|${username.toLowerCase()}`;
    if (throttled(tk)) throw new HttpError(429, '試行回数が多すぎます。しばらくしてから再度お試しください');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const calc = await hashPw(password, u ? u.pass_salt : DUMMY_SALT);
    if (!u || !timingSafeEqual(calc, u.pass_hash)) {
      noteFail(tk);
      throw new HttpError(401, 'ユーザー名またはパスワードが違います');
    }
    fails.delete(tk);
    createSession(res, u.id);
    return { user: publicUser(u) };
  });

  route('POST', '/api/logout', ({ req, res }) => {
    const t = cookieToken(req);
    if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });

  route('GET', '/api/me', ({ req }) => {
    const u = currentUser(req);
    return { user: u ? publicUser(u) : null };
  });

  route('GET', '/api/models', ({ req }) => { requireUser(req); return { models: MODELS }; });

  route('GET', '/api/posts', ({ req, url }) => {
    requireUser(req);
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const rows = db.prepare(`${POST_SELECT} WHERE p.id < ? ORDER BY p.created_at DESC, p.id DESC LIMIT 100`).all(before);
    return { posts: rows.map(postRow) };
  });

  route('POST', '/api/posts', ({ req, body }) => {
    const u = requireActive(req);
    const text = validatePost(body.body);
    const r = db.prepare('INSERT INTO posts (user_id, body, created_at) VALUES (?,?,?)').run(u.id, text, Date.now());
    return { post: postRow(db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(r.lastInsertRowid)) };
  });

  route('DELETE', '/api/posts/(\\d+)', ({ req, m }) => {
    const u = requireUser(req);
    const p = db.prepare(`SELECT p.id, p.user_id, l.owner_id FROM posts p LEFT JOIN llm_accounts l ON l.id = p.llm_id WHERE p.id = ?`).get(Number(m[1]));
    if (!p) throw new HttpError(404, '投稿が見つかりません');
    const owner = p.user_id ?? p.owner_id;
    if (!u.is_admin && owner !== u.id) throw new HttpError(403, 'この投稿は削除できません');
    db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
    return { ok: true };
  });

  route('PUT', '/api/key', ({ req, body }) => {
    const u = requireUser(req);
    const k = body.key;
    if (typeof k !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(k)) throw bad('APIキーは1〜256文字の英数字記号で入力してください');
    const e = encrypt(k, u.id);
    db.prepare(`INSERT INTO api_keys (user_id, iv, tag, ciphertext, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET iv=excluded.iv, tag=excluded.tag, ciphertext=excluded.ciphertext, updated_at=excluded.updated_at`)
      .run(u.id, e.iv, e.tag, e.ciphertext, Date.now());
    return { hasApiKey: true };
  });

  route('DELETE', '/api/key', ({ req }) => {
    const u = requireUser(req);
    db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(u.id);
    return { hasApiKey: false };
  });

  route('GET', '/api/llms', ({ req }) => {
    const u = requireUser(req);
    return { llms: db.prepare('SELECT * FROM llm_accounts WHERE owner_id = ? ORDER BY id').all(u.id).map(llmRow) };
  });

  route('POST', '/api/llms', ({ req, body }) => {
    const u = requireUser(req);
    const v = validateLlm(body);
    const r = db.prepare('INSERT INTO llm_accounts (owner_id, display_name, model, instruction, created_at) VALUES (?,?,?,?,?)')
      .run(u.id, v.name, v.model, v.instruction, Date.now());
    return { llm: llmRow(db.prepare('SELECT * FROM llm_accounts WHERE id = ?').get(r.lastInsertRowid)) };
  });

  const ownLlm = (u, id) => {
    const l = db.prepare('SELECT * FROM llm_accounts WHERE id = ? AND owner_id = ?').get(Number(id), u.id);
    if (!l) throw new HttpError(404, 'LLMアカウントが見つかりません');
    return l;
  };

  route('PUT', '/api/llms/(\\d+)', ({ req, body, m }) => {
    const u = requireUser(req);
    const l = ownLlm(u, m[1]);
    const v = validateLlm(body);
    db.prepare('UPDATE llm_accounts SET display_name=?, model=?, instruction=? WHERE id=?').run(v.name, v.model, v.instruction, l.id);
    return { llm: llmRow(db.prepare('SELECT * FROM llm_accounts WHERE id = ?').get(l.id)) };
  });

  route('POST', '/api/llms/(\\d+)/generate', async ({ req, m }) => {
    const u = requireActive(req);
    const l = ownLlm(u, m[1]);
    const k = db.prepare('SELECT * FROM api_keys WHERE user_id = ?').get(u.id);
    if (!k) throw bad('先にOpenRouter APIキーを登録してください');
    const text = await callUpstream(decrypt(k, u.id), l.model, l.instruction);
    // 生成中に停止・設定変更された場合に備えて再確認
    const fresh = db.prepare('SELECT suspended FROM users WHERE id = ?').get(u.id);
    if (!fresh || fresh.suspended) throw new HttpError(403, 'アカウントが利用停止中のため投稿できません');
    if (!db.prepare('SELECT 1 FROM llm_accounts WHERE id = ?').get(l.id)) throw new HttpError(404, 'LLMアカウントが見つかりません');
    const r = db.prepare('INSERT INTO posts (llm_id, body, created_at) VALUES (?,?,?)').run(l.id, text, Date.now());
    return { post: postRow(db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(r.lastInsertRowid)) };
  });

  route('GET', '/api/admin/users', ({ req }) => {
    requireAdmin(req);
    const rows = db.prepare('SELECT id, username, is_admin, suspended, created_at FROM users ORDER BY id').all();
    return { users: rows.map((r) => ({ id: r.id, username: r.username, isAdmin: !!r.is_admin, suspended: !!r.suspended, createdAt: r.created_at })) };
  });

  for (const [action, value] of [['suspend', 1], ['unsuspend', 0]]) {
    route('POST', `/api/admin/users/(\\d+)/${action}`, ({ req, m }) => {
      const a = requireAdmin(req);
      const id = Number(m[1]);
      const t = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!t) throw new HttpError(404, 'ユーザーが見つかりません');
      if (t.is_admin || t.id === a.id) throw bad('管理者は停止できません');
      db.prepare('UPDATE users SET suspended = ? WHERE id = ?').run(value, id);
      return { ok: true };
    });
  }

  // ---- 模擬API（テスト確認用。統計はループバックからのみ） ----
  const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  route('POST', '/mock/api/v1/chat/completions', ({ req, body, res }) => {
    const [status, out] = mock.chat(req, body);
    res.statusCode = status;
    return out;
  });
  route('GET', '/mock/_stats', ({ req }) => {
    if (!isLoopback(req)) throw new HttpError(403, 'forbidden');
    return mock.stats();
  });
  route('POST', '/mock/_reset', ({ req }) => {
    if (!isLoopback(req)) throw new HttpError(403, 'forbidden');
    mock.reset();
    return { ok: true };
  });

  // ---- 静的ファイル ----
  const STATIC = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
  };

  const SEC_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 32768) { reject(new HttpError(413, 'リクエストが大きすぎます')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!size) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0;
          resolve(v);
        } catch { reject(bad('JSONが不正です')); }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
    const send = (status, obj) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        res.setHeader('Content-Type', type);
        return res.end(readFileSync(join(here, 'public', file)));
      }
      let matched = null; let m = null;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        m = r.re.exec(url.pathname);
        if (m) { matched = r; break; }
      }
      if (!matched) return send(404, { error: '見つかりません' });
      let body = {};
      if (req.method !== 'GET') {
        // CSRF対策: 別オリジンからのリクエストを拒否し、JSON以外は受け付けない
        const origin = req.headers.origin;
        if (origin && !url.pathname.startsWith('/mock/')) {
          let ok = false;
          try { ok = new URL(origin).host === req.headers.host; } catch { /* 不正 */ }
          if (!ok) throw new HttpError(403, '不正なオリジンです');
        }
        if (req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined
          && !/^application\/json/i.test(req.headers['content-type'] || '')) {
          throw new HttpError(415, 'Content-Type は application/json にしてください');
        }
        body = await readBody(req);
      }
      send(res.statusCode === 200 ? 200 : res.statusCode, await matched.fn({ req, res, url, body, m }));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: 'サーバーエラーが発生しました' });
    }
  });

  return { server, db, mock, port };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, port } = createApp();
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`SNS-01 起動: http://${host}:${port}`));
}
