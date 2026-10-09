'use strict';
// 実サーバーを子プロセスで起動し、HTTP経由で一連の機能と再起動後の永続化を確認する。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHarness } = require('./harness');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sns01-test-'));
const PORT = 3900 + Math.floor(Math.random() * 50);
const MOCK_PORT = 4900 + Math.floor(Math.random() * 50);
const env = { ...process.env, DATA_DIR, PORT: String(PORT), MOCK_PORT: String(MOCK_PORT) };
delete env.OPENROUTER_BASE_URL;

let h;
const startServer = () => h.start();
const stopServer = () => h.stop();

class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, p, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf && method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await h.request('app', method, p, headers, body === undefined ? undefined : JSON.stringify(body));
    const sc = res.headers['set-cookie'];
    if (sc) this.cookie = sc[0].split(';')[0];
    let data = {};
    try { data = JSON.parse(res.text); } catch { /* not json */ }
    if (data.csrfToken) this.csrf = data.csrfToken;
    return { status: res.status, data };
  }
}
const mock = async (method, p, body) => {
  const r = await h.request('mock', method, p, body ? { 'Content-Type': 'application/json' } : {}, body && JSON.stringify(body));
  return JSON.parse(r.text);
};
const mockCalls = () => mock('GET', '/__mock/calls');
const mockReset = () => mock('POST', '/__mock/reset');
const keyId = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 12);

const alice = new Client();
const bob = new Client();
const admin = new Client();
const ids = {};

before(async () => {
  h = await createHarness({ env });
  console.log(`# transport: ${h.mode}`);
  execFileSync(process.execPath, ['scripts/create-admin.js', 'root_admin'], { cwd: ROOT, env: { ...env, ADMIN_PASSWORD: 'test-only-admin-password' } });
  await startServer();
});
after(async () => {
  await stopServer();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('登録・ログイン・ログアウト', async () => {
  assert.equal((await alice.req('POST', '/api/register', { username: 'alice', password: 'alicepass1' })).status, 201);
  assert.equal((await bob.req('POST', '/api/register', { username: 'bob', password: 'bobpass12' })).status, 201);
  assert.equal((await alice.req('POST', '/api/register', { username: 'ALICE', password: 'xxxxxxxx' })).status, 409);
  assert.equal((await new Client().req('POST', '/api/login', { username: 'alice', password: 'wrong-pass' })).status, 401);
  const t = new Client();
  assert.equal((await t.req('POST', '/api/login', { username: 'alice', password: 'alicepass1' })).status, 200);
  assert.equal((await t.req('POST', '/api/logout')).status, 200);
  assert.equal((await t.req('GET', '/api/posts')).status, 401);
  const r = await admin.req('POST', '/api/login', { username: 'root_admin', password: 'test-only-admin-password' });
  assert.equal(r.data.user.role, 'admin');
  assert.equal((await new Client().req('GET', '/api/posts')).status, 401);
});

test('人間の投稿: 文字数検証 (コードポイント)', async () => {
  assert.equal((await alice.req('POST', '/api/posts', { content: '   ' })).status, 400);
  assert.equal((await alice.req('POST', '/api/posts', { content: 'a'.repeat(141) })).status, 400);
  // 絵文字(サロゲートペア)140個 = 140コードポイントは許可
  assert.equal((await alice.req('POST', '/api/posts', { content: '😀'.repeat(140) })).status, 201);
  assert.equal((await alice.req('POST', '/api/posts', { content: '😀'.repeat(141) })).status, 400);
  const r = await alice.req('POST', '/api/posts', { content: 'こんにちは、aliceです' });
  assert.equal(r.status, 201);
  ids.alicePost = r.data.id;
  ids.bobPost = (await bob.req('POST', '/api/posts', { content: 'bobの投稿' })).data.id;
});

test('CSRF・Origin検証', async () => {
  const c = new Client(); c.cookie = alice.cookie; // CSRFトークンなし
  assert.equal((await c.req('POST', '/api/posts', { content: 'x' })).status, 403);
  assert.equal((await alice.req('POST', '/api/posts', { content: 'x' }, { Origin: 'http://evil.example' })).status, 403);
});

test('APIキー: 登録・非表示・更新・削除', async () => {
  let r = await alice.req('GET', '/api/apikey');
  assert.deepEqual(r.data, { registered: false, updatedAt: null });
  r = await alice.req('PUT', '/api/apikey', { apiKey: 'dummy-key-alice-1' });
  assert.equal(r.data.registered, true);
  assert.ok(!JSON.stringify(r.data).includes('dummy-key'));
  r = await alice.req('GET', '/api/apikey');
  assert.equal(r.data.registered, true);
  assert.ok(!JSON.stringify(r.data).includes('dummy-key'));
  assert.equal((await alice.req('GET', '/api/me')).data.hasApiKey, true);
  // 他人・管理者からは見えない
  assert.equal((await bob.req('GET', '/api/apikey')).data.registered, false);
  const users = await admin.req('GET', '/api/admin/users');
  assert.ok(!JSON.stringify(users.data).includes('dummy-key'));
  // DBにも平文で保存しない
  for (const f of fs.readdirSync(DATA_DIR)) {
    assert.ok(!fs.readFileSync(path.join(DATA_DIR, f)).includes('dummy-key-alice-1'), f);
  }
  // 更新
  await alice.req('PUT', '/api/apikey', { apiKey: 'dummy-key-alice-2' });
  // 削除→再登録
  r = await alice.req('DELETE', '/api/apikey');
  assert.equal(r.data.registered, false);
  await alice.req('PUT', '/api/apikey', { apiKey: 'dummy-key-alice-2' });
  await bob.req('PUT', '/api/apikey', { apiKey: 'dummy-key-bob' });
});

test('LLMアカウント作成・変更・権限', async () => {
  assert.equal((await alice.req('POST', '/api/llm-accounts', { displayName: 'X', model: 'other/model', prompt: 'p' })).status, 400);
  let r = await alice.req('POST', '/api/llm-accounts', { displayName: 'アリスbotA', model: 'test/model-a', prompt: '天気について' });
  ids.llmA = r.data.id;
  r = await alice.req('POST', '/api/llm-accounts', { displayName: 'アリスbotB', model: 'test/model-b', prompt: '料理について' });
  ids.llmB = r.data.id;
  ids.bobLlm = (await bob.req('POST', '/api/llm-accounts', { displayName: 'ボブbot', model: 'test/model-a', prompt: '音楽' })).data.id;
  const list = (await alice.req('GET', '/api/llm-accounts')).data.accounts;
  assert.deepEqual(list.map((a) => a.model), ['test/model-a', 'test/model-b']);
  // 変更
  r = await alice.req('PUT', `/api/llm-accounts/${ids.llmA}`, { displayName: 'アリスbotA改', model: 'test/model-a', prompt: '天気について一言' });
  assert.equal(r.status, 200);
  // 他人のLLMアカウントは変更・生成・削除できない (管理者も)
  assert.equal((await bob.req('PUT', `/api/llm-accounts/${ids.llmA}`, { displayName: 'z', model: 'test/model-b', prompt: 'z' })).status, 404);
  assert.equal((await bob.req('POST', `/api/llm-accounts/${ids.llmA}/generate`)).status, 404);
  assert.equal((await admin.req('POST', `/api/llm-accounts/${ids.llmA}/generate`)).status, 404);
  assert.equal((await bob.req('DELETE', `/api/llm-accounts/${ids.llmA}`)).status, 404);
  assert.equal((await bob.req('GET', '/api/llm-accounts')).data.accounts.length, 1);
});

test('模擬API経由の生成: 所有者のキーと設定モデルを使用', async () => {
  await mockReset();
  let r = await alice.req('POST', `/api/llm-accounts/${ids.llmA}/generate`);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.model, 'test/model-a');
  r = await alice.req('POST', `/api/llm-accounts/${ids.llmB}/generate`);
  assert.equal(r.data.model, 'test/model-b');
  r = await bob.req('POST', `/api/llm-accounts/${ids.bobLlm}/generate`);
  assert.equal(r.status, 201);
  const calls = await mockCalls();
  assert.equal(calls.total, 3);
  assert.deepEqual(calls.calls.map((c) => [c.keyId, c.model]), [
    [keyId('dummy-key-alice-2'), 'test/model-a'],
    [keyId('dummy-key-alice-2'), 'test/model-b'],
    [keyId('dummy-key-bob'), 'test/model-a'],
  ]);
  // タイムライン表示: LLMであることとモデル
  const posts = (await bob.req('GET', '/api/posts')).data.posts;
  assert.equal(posts[0].authorType, 'llm');
  assert.equal(posts[0].llmName, 'ボブbot');
  assert.equal(posts[0].model, 'test/model-a');
  assert.equal(posts[1].model, 'test/model-b');
  assert.equal(posts[1].username, 'alice');
  assert.ok(posts.some((p) => p.authorType === 'human'));
  // 新しい順
  for (let i = 1; i < posts.length; i++) assert.ok(posts[i - 1].id > posts[i].id);
});

test('モデル失敗時はエラーで、他モデルへ切り替えない', async () => {
  await mockReset();
  await mock('POST', '/__mock/fail', { model: 'test/model-a' });
  const before = (await alice.req('GET', '/api/posts')).data.posts.length;
  const r = await alice.req('POST', `/api/llm-accounts/${ids.llmA}/generate`);
  assert.equal(r.status, 502);
  assert.match(r.data.error, /test\/model-a/);
  const calls = await mockCalls();
  assert.equal(calls.total, 1);
  assert.equal(calls.byModel['test/model-b'], undefined);
  assert.equal((await alice.req('GET', '/api/posts')).data.posts.length, before);
  await mockReset();
});

test('キー未登録では生成できない', async () => {
  const c = new Client();
  await c.req('POST', '/api/register', { username: 'carol', password: 'carolpass1' });
  const id = (await c.req('POST', '/api/llm-accounts', { displayName: 'c', model: 'test/model-b', prompt: 'p' })).data.id;
  const r = await c.req('POST', `/api/llm-accounts/${id}/generate`);
  assert.equal(r.status, 400);
  assert.equal((await mockCalls()).total, 0);
});

test('投稿削除の権限', async () => {
  assert.equal((await bob.req('DELETE', `/api/posts/${ids.alicePost}`)).status, 403);
  assert.equal((await alice.req('DELETE', `/api/posts/${ids.alicePost}`)).status, 200);
  assert.equal((await admin.req('DELETE', `/api/posts/${ids.bobPost}`)).status, 200);
  const posts = (await alice.req('GET', '/api/posts')).data.posts;
  assert.ok(!posts.some((p) => p.id === ids.alicePost || p.id === ids.bobPost));
});

test('管理者による利用停止・解除', async () => {
  const users = (await admin.req('GET', '/api/admin/users')).data.users;
  const bobId = users.find((u) => u.username === 'bob').id;
  const adminId = users.find((u) => u.username === 'root_admin').id;
  assert.equal((await bob.req('GET', '/api/admin/users')).status, 403);
  assert.equal((await bob.req('POST', `/api/admin/users/${bobId}/suspend`)).status, 403);
  assert.equal((await admin.req('POST', `/api/admin/users/${adminId}/suspend`)).status, 400);
  assert.equal((await admin.req('POST', `/api/admin/users/${bobId}/suspend`)).data.user.suspended, true);
  await mockReset();
  assert.equal((await bob.req('POST', '/api/posts', { content: '停止中' })).status, 403);
  assert.equal((await bob.req('POST', `/api/llm-accounts/${ids.bobLlm}/generate`)).status, 403);
  assert.equal((await mockCalls()).total, 0);
  assert.equal((await bob.req('GET', '/api/posts')).status, 200); // 閲覧は可
  ids.bobId = bobId;
});

test('再起動後のデータ保持', async () => {
  const before = (await alice.req('GET', '/api/posts')).data.posts;
  await stopServer();
  await startServer();
  // セッションも保持される
  const after = (await alice.req('GET', '/api/posts')).data.posts;
  assert.deepEqual(after, before);
  assert.equal((await alice.req('GET', '/api/apikey')).data.registered, true);
  assert.equal((await alice.req('GET', '/api/llm-accounts')).data.accounts.length, 2);
  const users = (await admin.req('GET', '/api/admin/users')).data.users;
  assert.equal(users.find((u) => u.username === 'bob').suspended, true);
  // 再起動後も暗号化キーを復号して生成できる
  const r = await alice.req('POST', `/api/llm-accounts/${ids.llmB}/generate`);
  assert.equal(r.status, 201);
  assert.equal((await mockCalls()).calls[0].keyId, keyId('dummy-key-alice-2'));
  // 停止解除で再び投稿可能
  await admin.req('POST', `/api/admin/users/${ids.bobId}/unsuspend`);
  assert.equal((await bob.req('POST', '/api/posts', { content: '復帰しました' })).status, 201);
});
