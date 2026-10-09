import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';

const bridged = process.env.SNS_TEST_NO_LISTEN === '1';
let virtualPort = 19000;
async function freePort() { if (bridged) return virtualPort++; const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
function child(file, args, env, ready) {
 const p = spawn(process.execPath, [...(bridged && !args.length ? ['--import', './test/stdio-http-bridge.js'] : []), file, ...args], { cwd: resolve('.'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
 let out = ''; p.stdout.on('data', b => out += b); p.stderr.on('data', b => out += b);
 const completion = once(p, 'exit');
 let serial = 0; const pending = new Map();
 p.on('message', m => { if (m.kind === 'response') { const call = pending.get(m.id); pending.delete(m.id); if (m.error) call.reject(Error(m.error)); else call.resolve(m.response); } });
 const rpc = request => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); p.send({ kind: 'request', id, request }); });
 return { p, completion, rpc, ready: new Promise((yes, no) => {
  const timer = setTimeout(() => no(Error('起動タイムアウト: ' + out)), 10000);
  p.stdout.on('data', () => { if (out.includes(ready)) { clearTimeout(timer); yes(); } });
  p.once('exit', code => { clearTimeout(timer); if (ready && !out.includes(ready)) no(Error(`起動失敗 ${code}: ${out}`)); else yes(); });
 }), stop: async () => { if (p.exitCode === null) p.kill('SIGTERM'); await completion; } };
}

test('SNS-01: 起動・HTTP操作・権限・モデル指定・再起動の統合検証', { timeout: 60000 }, async t => {
 const port = await freePort(); const mockPort = await freePort(); const base = `http://127.0.0.1:${port}`;
 const dir = mkdtempSync(join(resolve('.'), '.test-data-'));
 const env = { DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', APP_ORIGIN: base, OPENROUTER_URL: `http://127.0.0.1:${mockPort}/api/v1/chat/completions` };
 let app; let mock;
 t.after(async () => { if (app) await app.stop(); if (mock) await mock.stop(); rmSync(dir, { recursive: true, force: true }); });
 const adminCLI = child('server.js', ['create-admin'], { ...env, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin-password' }, '管理者を作成しました');
 await adminCLI.ready; assert.equal((await adminCLI.completion)[0], 0);
 mock = child('mock-api.js', [], { MOCK_PORT: String(mockPort) }, '模擬API:'); await mock.ready;
 app = child('server.js', [], env, 'SNS-01:'); await app.ready;
 connectOutbound();
 const users = { anonymous: '', alice: '', bob: '', admin: '' };
 function connectOutbound() {
  if (!bridged) return;
  app.p.on('message', async m => {
   if (m.kind !== 'outbound') return;
   try { app.p.send({ kind: 'outbound-result', id: m.id, response: await mock.rpc(m.request) }); }
   catch (e) { app.p.send({ kind: 'outbound-result', id: m.id, error: e.message }); }
  });
 }
 async function testFetch(url, options = {}) {
  if (!bridged) return fetch(url, options);
  const target = new URL(url).port === String(mockPort) ? mock : app;
  const response = await target.rpc({ path: new URL(url).pathname, method: options.method || 'GET', headers: options.headers || {}, body: options.body });
  const headers = new Headers(); for (const [key,value] of Object.entries(response.headers)) for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  return new Response(response.body, { status: response.status, headers });
 }
 async function request(who, path, method = 'GET', body, status = 200, extra = {}) {
  const res = await testFetch(base + path, { method, headers: { Cookie: users[who], ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}) });
  const data = await res.json(); assert.equal(res.status, status, `${who} ${method} ${path}: ${JSON.stringify(data)}`);
  if (res.headers.has('set-cookie')) users[who] = res.headers.get('set-cookie').split(';')[0];
  return data;
 }
 async function calls() { return (await testFetch(`http://127.0.0.1:${mockPort}/__calls`)).json(); }
 const keyId = key => createHash('sha256').update(key).digest('hex').slice(0,16);
 let alice; let bob; let botA; let botB; let bobBot; let humanPost;
 await t.test('日本語画面配信・登録・ログイン・ログアウト・権限昇格防止', async () => {
  const page = await testFetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /共有タイムライン/);
  for (const asset of ['/app.js','/style.css']) assert.equal((await testFetch(base + asset)).status, 200);
  await request('anonymous', '/api/posts', 'GET', undefined, 401);
  alice = await request('alice', '/api/register', 'POST', { username: 'alice', password: 'alice-password', role: 'admin' }, 201); assert.equal(alice.role, 'user');
  bob = await request('bob', '/api/register', 'POST', { username: 'bob', password: 'bob-password' }, 201);
  await request('anonymous', '/api/register', 'POST', { username: 'alice', password: 'some-password' }, 409);
  await request('alice', '/api/logout', 'POST'); await request('alice', '/api/me', 'GET', undefined, 401);
  await request('alice', '/api/login', 'POST', { username: 'alice', password: 'wrong-password' }, 401);
  await request('alice', '/api/login', 'POST', { username: 'alice', password: 'alice-password' });
  const admin = await request('admin', '/api/login', 'POST', { username: 'admin', password: 'admin-password' }); assert.equal(admin.role, 'admin');
  await request('bob', '/api/admin/users', 'GET', undefined, 403);
  await request('alice', '/api/posts', 'POST', { content: 'CSRF' }, 403, { Origin: 'http://evil.example' });
 });
 await t.test('人間の投稿・Unicodeコードポイント境界・共有表示', async () => {
  for (const content of ['', ' \n ', 'あ'.repeat(141), '😀'.repeat(141)]) await request('alice', '/api/posts', 'POST', { content }, 400);
  const emoji = await request('alice', '/api/posts', 'POST', { content: '😀'.repeat(140) }, 201);
  humanPost = await request('alice', '/api/posts', 'POST', { content: 'こんにちは、人間の投稿です。' }, 201);
  const posts = await request('bob', '/api/posts'); assert.equal(posts[0].id, humanPost.id); assert.equal(posts[1].id, emoji.id); assert.equal(posts[0].isLLM, false);
  await request('bob', `/api/posts/${humanPost.id}`, 'DELETE', {}, 403);
  await request('alice', `/api/posts/${emoji.id}`, 'DELETE');
 });
 await t.test('キー登録・暗号化・非開示・複数モデルアカウント作成・所有者制限', async () => {
  await request('alice', '/api/key', 'PUT', { key: 'dummy-alice' }); await request('bob', '/api/key', 'PUT', { key: 'dummy-bob' });
  assert.equal((await request('alice', '/api/me')).hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(await request('alice', '/api/me')), /dummy-alice|api_key/);
  assert.doesNotMatch(JSON.stringify(await request('admin', '/api/admin/users')), /dummy-|api_key|hasApiKey/);
  const inspect = new DatabaseSync(join(dir, 'sns.sqlite')); const stored = inspect.prepare('SELECT api_key,password FROM users WHERE id=?').get(alice.id); inspect.close();
  assert.notEqual(stored.api_key, 'dummy-alice'); assert.notEqual(stored.password, 'alice-password');
  assert.equal(readFileSync(join(dir, 'encryption.key')).length, 32);
  botA = await request('alice', '/api/bots', 'POST', { name: 'Aさん', model: 'test/model-a', prompt: '短い挨拶' }, 201);
  botB = await request('alice', '/api/bots', 'POST', { name: 'Bさん', model: 'test/model-b', prompt: '発見を紹介' }, 201);
  bobBot = await request('bob', '/api/bots', 'POST', { name: 'BobのLLM', model: 'test/model-b', prompt: '短い挨拶' }, 201);
  assert.equal((await request('alice', '/api/bots')).bots.length, 2);
  assert.equal((await request('bob', '/api/bots')).bots.length, 1);
  await request('alice', '/api/bots', 'POST', { name: '不可', model: 'other/model', prompt: 'a' }, 400);
  for (const who of ['bob','admin']) {
   await request(who, `/api/bots/${botA.id}`, 'PUT', { name: '改変', model: 'test/model-a', prompt: 'a' }, 404);
   await request(who, `/api/bots/${botA.id}/generate`, 'POST', {}, 404);
   await request(who, `/api/users/${alice.id}/key`, 'GET', undefined, 404);
  }
  await request('alice', '/api/key', 'GET', undefined, 404);
  assert.equal((await calls()).count, 0);
 });
 await t.test('模擬APIのBearerキー識別子・指定モデル・呼び出し回数・LLM表示', async () => {
  await request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 201);
  await request('alice', `/api/bots/${botB.id}/generate`, 'POST', {}, 201);
  await request('bob', `/api/bots/${bobBot.id}/generate`, 'POST', {}, 201);
  const log = await calls(); assert.equal(log.count, 3);
  assert.deepEqual(log.calls.map(c => [c.keyId,c.model,c.messageCount]), [[keyId('dummy-alice'),'test/model-a',2],[keyId('dummy-alice'),'test/model-b',2],[keyId('dummy-bob'),'test/model-b',2]]);
  const posts = await request('alice', '/api/posts'); assert.equal(posts[0].isLLM, true); assert.equal(posts[0].model, 'test/model-b'); assert.equal(posts[0].author_name, 'BobのLLM');
  await request('alice', `/api/bots/${botA.id}`, 'PUT', { name: '更新A', model: 'test/model-b', prompt: '変更後の指示' });
  await request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 201);
  assert.equal((await calls()).calls.at(-1).model, 'test/model-b');
  assert.equal((await request('bob', '/api/posts'))[0].author_name, '更新A');
 });
 await t.test('生成失敗・不正な長さ・キー更新と削除・フォールバックなし', async () => {
  const before = (await request('alice', '/api/posts')).length;
  const count = (await calls()).count;
  await request('alice', '/api/key', 'PUT', { key: 'dummy-fail' });
  const error = await request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 502); assert.match(error.error, /test\/model-b/);
  assert.equal((await calls()).count, count + 1); assert.equal((await calls()).calls.at(-1).model, 'test/model-b');
  for (const key of ['dummy-long','dummy-empty']) { await request('alice', '/api/key', 'PUT', { key }); await request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 502); }
  assert.equal((await request('alice', '/api/posts')).length, before);
  await request('alice', '/api/key', 'DELETE'); assert.equal((await request('alice', '/api/me')).hasApiKey, false);
  const noKeyCount = (await calls()).count; await request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 400); assert.equal((await calls()).count, noKeyCount);
  await request('alice', '/api/key', 'PUT', { key: 'dummy-alice-updated' });
  await request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 201); assert.equal((await calls()).calls.at(-1).keyId, keyId('dummy-alice-updated'));
 });
 await t.test('一般ユーザーの停止・LLMも停止・停止解除・管理者の全投稿削除', async () => {
  await request('bob', `/api/admin/users/${alice.id}/suspension`, 'PUT', { suspended: true }, 403);
  await request('admin', `/api/admin/users/${alice.id}/suspension`, 'PUT', { suspended: true });
  await request('alice', '/api/posts', 'POST', { content: '停止中' }, 403);
  const before = (await calls()).count; await request('alice', `/api/bots/${botB.id}/generate`, 'POST', {}, 403); assert.equal((await calls()).count, before);
  assert.equal((await request('alice', '/api/me')).suspended, true);
  await request('admin', `/api/admin/users/${alice.id}/suspension`, 'PUT', { suspended: false });
  await request('alice', '/api/posts', 'POST', { content: '解除後' }, 201);
  await request('alice', `/api/bots/${botB.id}/generate`, 'POST', {}, 201);
  await request('admin', `/api/posts/${humanPost.id}`, 'DELETE');
  const posts = await request('admin', '/api/posts'); const bpost = posts.find(p => p.user_id === bob.id); await request('admin', `/api/posts/${bpost.id}`, 'DELETE');
  const own = posts.find(p => p.user_id === alice.id && p.isLLM); await request('alice', `/api/posts/${own.id}`, 'DELETE');
  const admin = await request('admin', '/api/me'); await request('admin', `/api/admin/users/${admin.id}/suspension`, 'PUT', { suspended: true }, 403);
 });
 await t.test('生成中の停止とキー削除・重複生成の防止', async () => {
  async function waitForCall(n) { for (let i = 0; i < 100; i++) { if ((await calls()).count > n) return; await new Promise(r => setTimeout(r, 10)); } throw Error('模擬APIが呼ばれませんでした'); }
  await request('alice', '/api/key', 'PUT', { key: 'dummy-slow' });
  const postsBefore = (await request('alice', '/api/posts')).length; let n = (await calls()).count;
  let pending = request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 403); await waitForCall(n);
  await request('alice', `/api/bots/${botB.id}/generate`, 'POST', {}, 409);
  await request('admin', `/api/admin/users/${alice.id}/suspension`, 'PUT', { suspended: true }); await pending;
  await request('admin', `/api/admin/users/${alice.id}/suspension`, 'PUT', { suspended: false });
  n = (await calls()).count; pending = request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 409); await waitForCall(n);
  await request('alice', '/api/key', 'DELETE'); await pending;
  assert.equal((await request('alice', '/api/posts')).length, postsBefore);
  await request('alice', '/api/key', 'PUT', { key: 'dummy-persisted' });
 });
 await t.test('サーバー再起動後のユーザー・セッション・キー・LLM設定・投稿・停止状態の保持', async () => {
  await request('admin', `/api/admin/users/${bob.id}/suspension`, 'PUT', { suspended: true });
  const posts = await request('alice', '/api/posts'); const bots = await request('alice', '/api/bots');
  await app.stop(); app = child('server.js', [], env, 'SNS-01:'); await app.ready; connectOutbound();
  assert.deepEqual(await request('alice', '/api/posts'), posts); assert.deepEqual(await request('alice', '/api/bots'), bots);
  assert.equal((await request('alice', '/api/me')).hasApiKey, true); assert.equal((await request('bob', '/api/me')).suspended, true);
  await request('bob', `/api/bots/${bobBot.id}/generate`, 'POST', {}, 403);
  await request('alice', `/api/bots/${botA.id}/generate`, 'POST', {}, 201); assert.equal((await calls()).calls.at(-1).keyId, keyId('dummy-persisted'));
  await request('alice', '/api/logout', 'POST'); await request('alice', '/api/login', 'POST', { username: 'alice', password: 'alice-password' });
  await request('admin', `/api/admin/users/${bob.id}/suspension`, 'PUT', { suspended: false });
 });
});
