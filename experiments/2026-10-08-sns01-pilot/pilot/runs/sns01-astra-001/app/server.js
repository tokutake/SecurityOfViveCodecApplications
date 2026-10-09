import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const dbPath = join(dataDir, 'sns.sqlite');
const db = new DatabaseSync(dbPath);
chmodSync(dbPath, 0o600);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user', suspended INTEGER NOT NULL DEFAULT 0, api_key TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, model TEXT NOT NULL, prompt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bot_id INTEGER REFERENCES bots(id),
 author_name TEXT NOT NULL, model TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
`);
const keyPath = join(dataDir, 'encryption.key');
let encryptionKey;
try { encryptionKey = readFileSync(keyPath); }
catch (error) {
 if (error.code !== 'ENOENT') throw error;
 if (db.prepare('SELECT id FROM users WHERE api_key IS NOT NULL LIMIT 1').get()) throw Error('暗号鍵が見つかりません。dataのバックアップを復元してください。');
 encryptionKey = randomBytes(32); writeFileSync(keyPath, encryptionKey, { flag: 'wx', mode: 0o600 });
}
if (encryptionKey.length !== 32) throw Error('暗号鍵が不正です');
function encrypt(value) {
 const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
 const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
 return [iv, cipher.getAuthTag(), data].map(v => v.toString('base64')).join('.');
}
function decrypt(value) {
 const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64'));
 const cipher = createDecipheriv('aes-256-gcm', encryptionKey, iv); cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); }
function checkPassword(password, hash) { const [salt, value] = hash.split(':'); return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(value, 'hex')); }
const dummyPassword = hashPassword(randomBytes(32).toString('hex'));
const models = ['test/model-a', 'test/model-b'];
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function credentials(body) {
 if (typeof body.username !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(body.username)) fail(400, 'ユーザー名は半角英数字・_・-の3〜32文字です。');
 if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'パスワードは8〜128文字です。');
}
if (process.argv[2] === 'create-admin') {
 try {
  const username = process.env.ADMIN_USERNAME; const password = process.env.ADMIN_PASSWORD;
  credentials({ username, password });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail(409, 'そのユーザー名は既に存在します。');
  db.prepare("INSERT INTO users (username,password,role) VALUES (?,?,'admin')").run(username, hashPassword(password));
  console.log('管理者を作成しました: ' + username); db.close();
 } catch (e) { console.error(e.status ? e.message : '管理者を作成できませんでした。'); process.exitCode = 1; }
} else {
 const host = process.env.HOST || '127.0.0.1'; const port = Number(process.env.PORT || 3000);
 const endpoint = process.env.OPENROUTER_URL || 'http://127.0.0.1:4010/api/v1/chat/completions';
 const endpointUrl = new URL(endpoint);
 if (!['http:', 'https:'].includes(endpointUrl.protocol)) throw Error('OPENROUTER_URLはHTTP(S)のURLを指定してください');
 const origin = process.env.APP_ORIGIN || `http://${host}:${port}`;
 const pending = new Set();
 const authAttempts = new Map();
 function reply(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
 }
 async function bodyOf(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON形式で送信してください。');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 32768) fail(413, '送信内容が大きすぎます。'); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString()); if (!body || Array.isArray(body) || typeof body !== 'object') throw Error(); return body; }
  catch { fail(400, 'JSONが不正です。'); }
 }
 function tokenOf(req) { return /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]; }
 function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
 function sessionUser(req) {
  const token = tokenOf(req); if (!token) return null;
  return db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(tokenHash(token), Date.now());
 }
 function cookie(token, age = 604800) { return `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`; }
 function publicUser(u) { return { id: u.id, username: u.username, role: u.role, suspended: Boolean(u.suspended), hasApiKey: Boolean(u.api_key) }; }
 function active(u) { if (u.suspended) fail(403, '利用停止中のため投稿できません。'); }
 function botData(body) {
  if (typeof body.name !== 'string' || !body.name.trim() || [...body.name.trim()].length > 40) fail(400, '表示名は1〜40文字で入力してください。');
  if (!models.includes(body.model)) fail(400, '対応していないモデルです。');
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || [...body.prompt].length > 4000) fail(400, '指示文は1〜4000文字で入力してください。');
  return [body.name.trim(), body.model, body.prompt.trim()];
 }
 function validPost(value) { if (typeof value !== 'string' || !value.trim() || [...value].length > 140) fail(400, '投稿は空白のみを除く1〜140文字です。'); return value; }
 function ownBot(id, u) { const bot = db.prepare('SELECT * FROM bots WHERE id=? AND owner_id=?').get(id, u.id); if (!bot) fail(404, 'LLMアカウントが見つかりません。'); return bot; }
 const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
   const path = new URL(req.url, 'http://local').pathname; const method = req.method;
   if (!path.startsWith('/api/')) {
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (method !== 'GET' || !files[path]) fail(404, '見つかりません。');
    const [file, type] = files[path]; res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(readFileSync(join(root, 'public', file))); return;
   }
   if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) fail(405, '未対応の操作です。');
   if (method !== 'GET' && ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site')) fail(403, '送信元を確認できません。');
   const body = method === 'GET' ? {} : await bodyOf(req);
   if (method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
    const ip = req.socket.remoteAddress; const now = Date.now();
    for (const [key, v] of authAttempts) if (v.until <= now) authAttempts.delete(key);
    const attempts = authAttempts.get(ip) || { count: 0, until: now + 60000 };
    if (++attempts.count > 30) fail(429, '操作が多すぎます。1分後に再度お試しください。'); authAttempts.set(ip, attempts);
    credentials(body);
    let u;
    if (path === '/api/register') {
     if (db.prepare('SELECT id FROM users WHERE username=?').get(body.username)) fail(409, 'そのユーザー名は既に使われています。');
     const result = db.prepare('INSERT INTO users (username,password) VALUES (?,?)').run(body.username, hashPassword(body.password));
     u = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    } else {
     u = db.prepare('SELECT * FROM users WHERE username=?').get(body.username);
     const matches = checkPassword(body.password, u?.password || dummyPassword);
     if (!u || !matches) fail(401, 'ユーザー名またはパスワードが違います。');
    }
    const previous = tokenOf(req); if (previous) db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(previous));
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token), u.id, Date.now() + 604800000);
    reply(res, path === '/api/register' ? 201 : 200, publicUser(u), { 'Set-Cookie': cookie(token) }); return;
   }
   const u = sessionUser(req); if (!u) fail(401, 'ログインしてください。');
   if (method === 'GET' && path === '/api/me') return reply(res, 200, publicUser(u));
   if (method === 'POST' && path === '/api/logout') {
    db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(tokenOf(req))); return reply(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
   }
   if (path === '/api/key' && method === 'PUT') {
    if (typeof body.key !== 'string' || !body.key.trim() || body.key.length > 512 || /[\s\x00-\x1f\x7f]/.test(body.key)) fail(400, '有効なAPIキーを入力してください（空白不可・512文字以内）。');
    db.prepare('UPDATE users SET api_key=? WHERE id=?').run(encrypt(body.key), u.id); return reply(res, 200, { hasApiKey: true });
   }
   if (path === '/api/key' && method === 'DELETE') { db.prepare('UPDATE users SET api_key=NULL WHERE id=?').run(u.id); return reply(res, 200, { hasApiKey: false }); }
   if (path === '/api/posts' && method === 'GET') {
    const posts = db.prepare('SELECT p.*, u.username AS owner_name FROM posts p JOIN users u ON p.user_id=u.id ORDER BY p.id DESC').all();
    return reply(res, 200, posts.map(p => ({ ...p, isLLM: p.bot_id !== null, canDelete: u.role === 'admin' || u.id === p.user_id })));
   }
   if (path === '/api/posts' && method === 'POST') {
    active(u); const content = validPost(body.content);
    const result = db.prepare('INSERT INTO posts (user_id,author_name,content) VALUES (?,?,?)').run(u.id, u.username, content);
    return reply(res, 201, { id: Number(result.lastInsertRowid) });
   }
   let match;
   if ((match = /^\/api\/posts\/(\d+)$/.exec(path)) && method === 'DELETE') {
    const p = db.prepare('SELECT * FROM posts WHERE id=?').get(match[1]); if (!p) fail(404, '投稿が見つかりません。');
    if (u.role !== 'admin' && p.user_id !== u.id) fail(403, '他の利用者の投稿は削除できません。');
    db.prepare('DELETE FROM posts WHERE id=?').run(p.id); return reply(res, 200, { ok: true });
   }
   if (path === '/api/bots' && method === 'GET') return reply(res, 200, { models, bots: db.prepare('SELECT * FROM bots WHERE owner_id=? ORDER BY id DESC').all(u.id) });
   if (path === '/api/bots' && method === 'POST') {
    const [name, model, prompt] = botData(body);
    const result = db.prepare('INSERT INTO bots (owner_id,name,model,prompt) VALUES (?,?,?,?)').run(u.id, name, model, prompt);
    return reply(res, 201, { id: Number(result.lastInsertRowid) });
   }
   if ((match = /^\/api\/bots\/(\d+)$/.exec(path)) && method === 'PUT') {
    const bot = ownBot(match[1], u); const [name, model, prompt] = botData(body);
    db.prepare('UPDATE bots SET name=?,model=?,prompt=? WHERE id=?').run(name, model, prompt, bot.id); return reply(res, 200, { ok: true });
   }
   if ((match = /^\/api\/bots\/(\d+)\/generate$/.exec(path)) && method === 'POST') {
    active(u); const bot = ownBot(match[1], u);
    if (!u.api_key) fail(400, '先に自分のAPIキーを登録してください。');
    if (pending.has(u.id)) fail(409, '投稿を生成中です。完了までお待ちください。');
    pending.add(u.id);
    try {
     let response; let generated;
     try {
      response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
       headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${decrypt(u.api_key)}` },
       body: JSON.stringify({ model: bot.model, messages: [
        { role: 'system', content: '共有SNSへの投稿を1件だけ、日本語で生成してください。本文のみ、空白のみは禁止、Unicodeコードポイント数で140文字以内。' },
        { role: 'user', content: bot.prompt }
       ] }) });
      if (!response.ok) { await response.body?.cancel(); fail(502, `指定モデル ${bot.model} の生成に失敗しました（HTTP ${response.status}）。`); }
      const reader = response.body.getReader(); let size = 0; const parts = [];
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) { await reader.cancel(); throw Error('large response'); } parts.push(value); }
      generated = JSON.parse(Buffer.concat(parts).toString()).choices?.[0]?.message?.content;
     } catch (error) { if (error.status) throw error; fail(502, `指定モデル ${bot.model} のAPI通信に失敗しました。接続先とキーを確認してください。`); }
     if (typeof generated !== 'string' || !generated.trim() || [...generated].length > 140) fail(502, '生成された投稿が空、または140文字を超えています。再度生成してください。');
     // Await中の利用停止・キー削除/更新も投稿確定前に再確認する。
     const latest = db.prepare('SELECT * FROM users WHERE id=?').get(u.id); active(latest);
     if (latest.api_key !== u.api_key) fail(409, '生成中にAPIキーが変更されました。再度生成してください。');
     const result = db.prepare('INSERT INTO posts (user_id,bot_id,author_name,model,content) VALUES (?,?,?,?,?)').run(u.id, bot.id, bot.name, bot.model, generated);
     return reply(res, 201, { id: Number(result.lastInsertRowid) });
    } finally { pending.delete(u.id); }
   }
   if (path.startsWith('/api/admin/')) {
    if (u.role !== 'admin') fail(403, '管理者のみ操作できます。');
    if (path === '/api/admin/users' && method === 'GET') return reply(res, 200, db.prepare('SELECT id,username,role,suspended,created_at FROM users ORDER BY id').all());
    if ((match = /^\/api\/admin\/users\/(\d+)\/suspension$/.exec(path)) && method === 'PUT') {
     if (typeof body.suspended !== 'boolean') fail(400, '停止状態が不正です。');
     const target = db.prepare('SELECT id,role FROM users WHERE id=?').get(match[1]);
     if (!target) fail(404, '利用者が見つかりません。'); if (target.role !== 'user') fail(403, '管理者は利用停止にできません。');
     db.prepare('UPDATE users SET suspended=? WHERE id=?').run(Number(body.suspended), target.id); return reply(res, 200, { ok: true });
    }
   }
   fail(404, '見つかりません。');
  } catch (error) { reply(res, error.status || 500, { error: error.status ? error.message : 'サーバーエラーが発生しました。' }); }
 });
 server.listen(port, host, () => console.log(`SNS-01: ${origin}`));
 function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
 process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
