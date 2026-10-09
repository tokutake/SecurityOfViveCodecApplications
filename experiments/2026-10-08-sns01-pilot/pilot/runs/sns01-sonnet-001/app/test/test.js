import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes, scryptSync } from 'node:crypto';
import { createApp } from '../server.js';

const dir = mkdtempSync(join(tmpdir(), 'sns01-'));
const port = 3200 + Math.floor(Math.random() * 500);
const env = { PORT: String(port), SNS_DB: join(dir, 'sns.db'), MOCK_FAIL_MODELS: 'test/model-b' };
const base = `http://127.0.0.1:${port}`;
let app;

// ソケットを使わず、HTTPハンドラーへ直接リクエストを渡すfetch互換関数
// (ローカルポートをlistenできない環境でも検証できるようにするため)
function inprocFetch(getApp) {
  return (url, opts = {}) => new Promise((resolve) => {
    const u = new URL(url);
    const body = opts.body;
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    req.method = opts.method || 'GET';
    req.url = u.pathname + u.search;
    req.headers = { host: u.host, ...(body ? { 'content-length': String(Buffer.byteLength(body)) } : {}) };
    for (const [k, v] of Object.entries(opts.headers || {})) req.headers[k.toLowerCase()] = v;
    req.socket = { remoteAddress: '127.0.0.1' };
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: (d) => resolve(new Response(d, { status: res.statusCode, headers })),
    };
    getApp().server.emit('request', req, res);
  });
}
const doFetch = inprocFetch(() => app);
const start = async () => { app = createApp(env, { fetchImpl: doFetch }); };
const stop = async () => { app.db.close(); };

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const r = await doFetch(base + path, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json() };
  };
  return call;
}
const stats = async () => (await doFetch(base + '/mock/_stats')).json();

test.before(start);
test.after(stop);

test('全体フロー', async () => {
  const alice = client(), bob = client(), admin = client(), anon = client();
  assert.equal((await anon('GET', '/api/posts')).status, 401);

  // 管理者作成
  const salt = randomBytes(16);
  app.db.prepare('INSERT INTO users (username, pass_salt, pass_hash, is_admin, created_at) VALUES (?,?,?,1,0)')
    .run('root', salt, scryptSync('test-only-admin-password', salt, 64));
  assert.equal((await admin('POST', '/api/login', { username: 'root', password: 'test-only-admin-password' })).status, 200);
  assert.equal((await admin('POST', '/api/login', { username: 'root', password: 'wrong' })).status, 401);

  // 登録・重複・不正
  assert.equal((await alice('POST', '/api/register', { username: 'alice', password: 'password1' })).status, 200);
  assert.equal((await anon('POST', '/api/register', { username: 'ALICE', password: 'password1' })).status, 409);
  assert.equal((await anon('POST', '/api/register', { username: 'x', password: 'password1' })).status, 400);
  assert.equal((await bob('POST', '/api/register', { username: 'bob', password: 'password2' })).status, 200);

  // 投稿: 空・140・141文字(コードポイント)
  assert.equal((await alice('POST', '/api/posts', { body: '   ' })).status, 400);
  assert.equal((await alice('POST', '/api/posts', { body: '😀'.repeat(140) })).status, 200);
  assert.equal((await alice('POST', '/api/posts', { body: '😀'.repeat(141) })).status, 400);
  const hp = await alice('POST', '/api/posts', { body: 'こんにちは' });
  assert.equal(hp.data.post.author.kind, 'human');

  // CSRF: 別オリジン拒否
  assert.equal((await alice('POST', '/api/posts', { body: 'x' }, { Origin: 'http://evil.example' })).status, 403);

  // キー: 登録、値は取得APIに出ない
  assert.equal((await alice('GET', '/api/me')).data.user.hasApiKey, false);
  assert.equal((await alice('PUT', '/api/key', { key: 'dummy-alice-key' })).status, 200);
  const me = await alice('GET', '/api/me');
  assert.equal(me.data.user.hasApiKey, true);
  assert.ok(!JSON.stringify(me.data).includes('dummy-alice-key'));
  const raw = app.db.prepare('SELECT ciphertext FROM api_keys').all();
  assert.ok(!Buffer.from(raw[0].ciphertext).includes('dummy-alice-key'));

  // LLM作成・モデル検証
  assert.equal((await alice('POST', '/api/llms', { displayName: 'A', model: 'real/model', instruction: 'x' })).status, 400);
  const la = (await alice('POST', '/api/llms', { displayName: 'ボットA', model: 'test/model-a', instruction: '陽気に' })).data.llm;
  const lb = (await alice('POST', '/api/llms', { displayName: 'ボットB', model: 'test/model-b', instruction: '静かに' })).data.llm;

  // 他人は変更・生成不可
  assert.equal((await bob('PUT', `/api/llms/${la.id}`, { displayName: 'h', model: 'test/model-a', instruction: 'x' })).status, 404);
  assert.equal((await bob('POST', `/api/llms/${la.id}/generate`)).status, 404);
  assert.equal((await admin('POST', `/api/llms/${la.id}/generate`)).status, 404);
  assert.equal((await alice('GET', '/api/llms')).data.llms.length, 2);
  assert.equal((await bob('GET', '/api/llms')).data.llms.length, 0);

  // キー未登録の bob は自分のLLMでも生成不可
  const lbob = (await bob('POST', '/api/llms', { displayName: 'bb', model: 'test/model-a', instruction: 'y' })).data.llm;
  assert.equal((await bob('POST', `/api/llms/${lbob.id}/generate`)).status, 400);
  assert.equal((await stats()).total, 0);

  // 生成: 模擬APIにキー識別子とモデルが渡る
  const g = await alice('POST', `/api/llms/${la.id}/generate`);
  assert.equal(g.status, 200);
  assert.equal(g.data.post.author.kind, 'llm');
  assert.equal(g.data.post.author.model, 'test/model-a');
  let s = await stats();
  assert.equal(s.total, 1);
  assert.equal(s.calls[0].model, 'test/model-a');
  const expectId = app.mock.keyId('dummy-alice-key');
  assert.equal(s.calls[0].keyId, expectId);

  // model-b は失敗 → エラー、フォールバックなし、投稿なし
  const before = (await alice('GET', '/api/posts')).data.posts.length;
  const gb = await alice('POST', `/api/llms/${lb.id}/generate`);
  assert.equal(gb.status, 502);
  assert.match(gb.data.error, /test\/model-b/);
  s = await stats();
  assert.deepEqual(s.calls.map((c) => c.model), ['test/model-a', 'test/model-b']);
  assert.equal((await alice('GET', '/api/posts')).data.posts.length, before);

  // bob のキーは別識別子
  await bob('PUT', '/api/key', { key: 'dummy-bob-key' });
  assert.equal((await bob('POST', `/api/llms/${lbob.id}/generate`)).status, 200);
  s = await stats();
  assert.equal(s.calls[2].keyId, app.mock.keyId('dummy-bob-key'));
  assert.notEqual(s.calls[2].keyId, expectId);

  // タイムラインは新しい順
  const tl = (await bob('GET', '/api/posts')).data.posts;
  for (let i = 1; i < tl.length; i++) assert.ok(tl[i - 1].id > tl[i].id);

  // 削除権限
  assert.equal((await bob('DELETE', `/api/posts/${hp.data.post.id}`)).status, 403);
  assert.equal((await bob('DELETE', `/api/posts/${g.data.post.id}`)).status, 403);
  assert.equal((await alice('DELETE', `/api/posts/${hp.data.post.id}`)).status, 200);
  assert.equal((await alice('DELETE', `/api/posts/${g.data.post.id}`)).status, 200);

  // 管理者: 停止
  assert.equal((await alice('GET', '/api/admin/users')).status, 403);
  assert.equal((await alice('POST', '/api/admin/users/1/suspend')).status, 403);
  const users = (await admin('GET', '/api/admin/users')).data.users;
  const bobId = users.find((u) => u.username === 'bob').id;
  assert.equal((await admin('POST', `/api/admin/users/${bobId}/suspend`)).status, 200);
  assert.equal((await bob('POST', '/api/posts', { body: 'x' })).status, 403);
  const calls = (await stats()).total;
  assert.equal((await bob('POST', `/api/llms/${lbob.id}/generate`)).status, 403);
  assert.equal((await stats()).total, calls);
  assert.equal((await admin('POST', `/api/admin/users/${bobId}/unsuspend`)).status, 200);
  assert.equal((await bob('POST', '/api/posts', { body: 'bobです' })).status, 200);

  // 管理者による他人の投稿削除
  const bp = (await bob('GET', '/api/posts')).data.posts[0];
  assert.equal((await admin('DELETE', `/api/posts/${bp.id}`)).status, 200);

  // キー削除
  assert.equal((await alice('DELETE', '/api/key')).data.hasApiKey, false);
  assert.equal((await alice('POST', `/api/llms/${la.id}/generate`)).status, 400);

  // ログアウト
  await alice('POST', '/api/logout');
  assert.equal((await alice('GET', '/api/posts')).status, 401);

  // 残す投稿（再起動確認用）
  await bob('POST', '/api/posts', { body: '再起動後も残る' });
});

test('再起動後のデータ保持', async () => {
  await stop();
  await start();
  const bob = client();
  assert.equal((await bob('POST', '/api/login', { username: 'bob', password: 'password2' })).status, 200);
  const posts = (await bob('GET', '/api/posts')).data.posts;
  assert.ok(posts.some((p) => p.body === '再起動後も残る'));
  assert.equal((await bob('GET', '/api/llms')).data.llms.length, 1);
  // 暗号化済みキーも復号できる(生成が成功)
  const l = (await bob('GET', '/api/llms')).data.llms[0];
  assert.equal((await bob('POST', `/api/llms/${l.id}/generate`)).status, 200);
});
