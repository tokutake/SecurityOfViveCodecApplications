import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { createMockOpenRouter, keyIdOf } from '../mock/mock-openrouter.js';
import { fetchVia, inject } from './helpers.js';

const OPENROUTER_BASE = 'http://mock.local/api/v1';
const mock = createMockOpenRouter();
const tempDirs = [];

function makeApp({ dbPath = ':memory:', secret = randomBytes(32), target = mock } = {}) {
  const db = openDatabase(dbPath);
  const handler = createApp({
    db,
    secret,
    openRouterBaseUrl: OPENROUTER_BASE,
    fetchImpl: fetchVia(target.handle),
  });
  return { db, handler };
}

class Client {
  constructor(app) {
    this.app = app;
    this.cookie = null;
  }

  async request(method, url, body, { raw } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (raw !== undefined) {
      headers['content-type'] = 'text/plain';
      payload = raw;
    } else if (['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body ?? {});
    }
    const res = await inject(this.app.handler, { method, url, headers, body: payload });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const value = setCookie.split(';')[0];
      this.cookie = value.endsWith('=') ? null : value;
    }
    return { status: res.status, data: res.text ? JSON.parse(res.text) : null, text: res.text };
  }

  get(url) { return this.request('GET', url); }
  post(url, body) { return this.request('POST', url, body); }
  put(url, body) { return this.request('PUT', url, body); }
  patch(url, body) { return this.request('PATCH', url, body); }
  del(url) { return this.request('DELETE', url); }
}

let app;

async function registerUser(name, password = 'password123') {
  const client = new Client(app);
  const res = await client.post('/api/auth/register', { username: name, password });
  assert.equal(res.status, 201, res.text);
  return client;
}

async function seedAdmin(name, password = 'adminpass1') {
  const hash = await hashPassword(password);
  app.db
    .prepare('INSERT INTO users (username, password_hash, role, suspended, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(name, hash, 'admin', new Date().toISOString());
}

async function loginAs(name, password) {
  const client = new Client(app);
  const res = await client.post('/api/auth/login', { username: name, password });
  assert.equal(res.status, 200, res.text);
  return client;
}

async function createAccount(client, { displayName = 'LLM', modelId = 'test/model-a', instruction = '短く話す' } = {}) {
  const res = await client.post('/api/llm-accounts', { displayName, modelId, instruction });
  assert.equal(res.status, 201, res.text);
  return res.data.account;
}

before(() => {
  app = makeApp();
});

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  mock.calls.length = 0;
});

describe('認証', () => {
  it('登録・ログイン・me・ログアウトができる', async () => {
    const client = new Client(app);
    const reg = await client.post('/api/auth/register', { username: 'auth_user1', password: 'password123' });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.user.role, 'user');
    assert.ok(client.cookie, 'セッションCookieが発行される');

    assert.equal((await client.get('/api/auth/me')).data.user.username, 'auth_user1');

    await client.post('/api/auth/logout');
    assert.equal((await client.get('/api/auth/me')).data.user, null);

    const login = await new Client(app).post('/api/auth/login', { username: 'auth_user1', password: 'password123' });
    assert.equal(login.status, 200);
  });

  it('重複ユーザー名・誤ったパスワード・短いパスワードを拒否する', async () => {
    await registerUser('auth_user2');
    const dup = await new Client(app).post('/api/auth/register', { username: 'auth_user2', password: 'password123' });
    assert.equal(dup.status, 409);

    const wrong = await new Client(app).post('/api/auth/login', { username: 'auth_user2', password: 'nope-nope' });
    assert.equal(wrong.status, 401);

    const short = await new Client(app).post('/api/auth/register', { username: 'auth_user3', password: 'short' });
    assert.equal(short.status, 400);
  });

  it('未ログインでは保護APIに入れず、JSON以外のPOSTは拒否される', async () => {
    assert.equal((await new Client(app).get('/api/timeline')).status, 401);
    const client = await registerUser('auth_user4');
    const res = await client.request('POST', '/api/posts', undefined, { raw: 'body=hi' });
    assert.equal(res.status, 415);
  });

  it('存在しないパスと未許可メソッドを適切に返す', async () => {
    const client = new Client(app);
    assert.equal((await client.get('/api/unknown')).status, 404);
    assert.equal((await client.request('PUT', '/api/timeline', {})).status, 405);
  });
});

describe('投稿とタイムライン', () => {
  it('140コードポイントまでは投稿でき、141は拒否される（絵文字もコードポイント単位）', async () => {
    const client = await registerUser('post_user1');
    assert.equal((await client.post('/api/posts', { body: '😀'.repeat(140) })).status, 201);
    assert.equal((await client.post('/api/posts', { body: '😀'.repeat(141) })).status, 400);
    assert.equal((await client.post('/api/posts', { body: '   ' })).status, 400);
  });

  it('タイムラインは新しい順で人間とLLMの投稿を含む', async () => {
    const client = await registerUser('post_user2');
    await client.post('/api/posts', { body: 'first-human' });
    await client.put('/api/me/api-key', { apiKey: 'dummy-key-order' });
    const account = await createAccount(client, { displayName: 'ボットA' });
    const gen = await client.post(`/api/llm-accounts/${account.id}/generate`);
    assert.equal(gen.status, 201, gen.text);
    await client.post('/api/posts', { body: 'second-human' });

    const { posts } = (await client.get('/api/timeline')).data;
    assert.equal(posts[0].body, 'second-human');
    assert.equal(posts[1].authorType, 'llm');
    assert.equal(posts[1].authorName, 'ボットA');
    assert.equal(posts[1].modelId, 'test/model-a');
    assert.equal(posts[2].body, 'first-human');
    assert.equal(posts[2].authorType, 'human');
  });

  it('自分の投稿は削除でき、他人の投稿は削除できない。管理者は全投稿を削除できる', async () => {
    const alice = await registerUser('post_alice');
    const bob = await registerUser('post_bob');
    const alicePost = (await alice.post('/api/posts', { body: 'alice says hi' })).data.post;
    const bobPost = (await bob.post('/api/posts', { body: 'bob says hi' })).data.post;

    assert.equal((await alice.del(`/api/posts/${bobPost.id}`)).status, 403);
    assert.equal((await alice.del(`/api/posts/${alicePost.id}`)).status, 204);

    await seedAdmin('post_admin');
    const admin = await loginAs('post_admin', 'adminpass1');
    assert.equal((await admin.del(`/api/posts/${bobPost.id}`)).status, 204);
    assert.equal((await admin.del(`/api/posts/${bobPost.id}`)).status, 404);
  });
});

describe('OpenRouter APIキー', () => {
  it('登録・更新・削除でき、キーの値は取得APIに出ない', async () => {
    const client = await registerUser('key_user1');
    const secretKey = 'dummy-key-secret-value-111';

    assert.equal((await client.get('/api/me/api-key')).data.registered, false);
    const put = await client.put('/api/me/api-key', { apiKey: secretKey });
    assert.equal(put.status, 200);
    assert.equal(put.text.includes(secretKey), false);

    const status = await client.get('/api/me/api-key');
    assert.equal(status.data.registered, true);
    assert.equal(status.text.includes(secretKey), false);

    const timeline = await client.get('/api/timeline');
    assert.equal(timeline.text.includes(secretKey), false);

    assert.equal((await client.del('/api/me/api-key')).status, 204);
    assert.equal((await client.get('/api/me/api-key')).data.registered, false);
  });

  it('DBにはキーが平文で保存されない', async () => {
    const client = await registerUser('key_user2');
    const secretKey = 'dummy-key-plaintext-check-222';
    await client.put('/api/me/api-key', { apiKey: secretKey });
    const rows = app.db.prepare('SELECT iv, tag, ciphertext FROM api_keys').all();
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(Buffer.from(row.ciphertext).toString('utf8').includes(secretKey), false);
    }
  });

  it('他の利用者と管理者はキーを閲覧・代理利用できない（LLMアカウントも所有者のみ）', async () => {
    const owner = await registerUser('key_owner');
    await owner.put('/api/me/api-key', { apiKey: 'dummy-key-owner-333' });
    const account = await createAccount(owner, { displayName: '所有者のLLM' });

    const other = await registerUser('key_other');
    assert.equal((await other.get('/api/me/api-key')).data.registered, false);
    assert.equal((await other.post(`/api/llm-accounts/${account.id}/generate`)).status, 403);
    assert.equal((await other.patch(`/api/llm-accounts/${account.id}`, { displayName: 'x' })).status, 403);

    await seedAdmin('key_admin');
    const admin = await loginAs('key_admin', 'adminpass1');
    assert.equal((await admin.post(`/api/llm-accounts/${account.id}/generate`)).status, 403);
    assert.equal(mock.calls.length, 0, '他人のキーでは一度も呼び出されない');
  });
});

describe('LLMアカウントと模擬API経由の投稿', () => {
  it('作成・設定変更・指定モデルでの生成ができ、模擬APIでキー識別子とモデルを確認できる', async () => {
    const client = await registerUser('llm_user1');
    const key = 'dummy-key-llm-user1-444';
    await client.put('/api/me/api-key', { apiKey: key });

    const a = await createAccount(client, { displayName: 'LLM-A', modelId: 'test/model-a', instruction: '前向きに' });
    const b = await createAccount(client, { displayName: 'LLM-B', modelId: 'test/model-b', instruction: '慎重に' });
    assert.notEqual(a.id, b.id);

    const renamed = await client.patch(`/api/llm-accounts/${b.id}`, { displayName: 'LLM-B改', instruction: '丁寧に' });
    assert.equal(renamed.data.account.displayName, 'LLM-B改');
    assert.equal(renamed.data.account.modelId, 'test/model-b');

    const gen = await client.post(`/api/llm-accounts/${b.id}/generate`);
    assert.equal(gen.status, 201, gen.text);
    assert.equal(gen.data.post.authorType, 'llm');
    assert.equal(gen.data.post.modelId, 'test/model-b');
    assert.equal(gen.data.post.authorName, 'LLM-B改');
    assert.match(gen.data.post.body, /test\/model-b/);

    assert.equal(mock.calls.length, 1, '模擬APIの呼び出しは1回');
    assert.equal(mock.calls[0].keyId, keyIdOf(key));
    assert.equal(mock.calls[0].model, 'test/model-b');
  });

  it('モデル指定が不正なら作成・変更できない', async () => {
    const client = await registerUser('llm_user2');
    const res = await client.post('/api/llm-accounts', { displayName: 'x', modelId: 'openai/gpt-x', instruction: 'x' });
    assert.equal(res.status, 400);
    const account = await createAccount(client);
    assert.equal((await client.patch(`/api/llm-accounts/${account.id}`, { modelId: 'bad/model' })).status, 400);
  });

  it('APIキー未登録では生成できない', async () => {
    const client = await registerUser('llm_user3');
    const account = await createAccount(client, { displayName: 'no-key' });
    const res = await client.post(`/api/llm-accounts/${account.id}/generate`);
    assert.equal(res.status, 400);
    assert.equal(mock.calls.length, 0);
  });

  it('指定モデルが失敗したらエラーを返し、他モデルへ切り替えず投稿も作らない', async () => {
    const failing = createMockOpenRouter({ failModels: ['test/model-b'] });
    const failApp = makeApp({ target: failing });
    const client = new Client(failApp);
    const reg = await client.post('/api/auth/register', { username: 'fail_user', password: 'password123' });
    assert.equal(reg.status, 201);
    await client.put('/api/me/api-key', { apiKey: 'dummy-key-fail-666' });
    const created = await client.post('/api/llm-accounts', {
      displayName: 'f',
      modelId: 'test/model-b',
      instruction: 'x',
    });
    const res = await client.post(`/api/llm-accounts/${created.data.account.id}/generate`);
    assert.equal(res.status, 502);
    assert.match(res.data.error, /test\/model-b/);
    assert.equal(failing.calls.length, 1, '障害モデルへ1回だけ呼び出す');
    assert.equal(failing.calls[0].model, 'test/model-b');
    assert.equal(mock.calls.length, 0, '正常な模擬APIへは振り替えない');
    assert.equal((await client.get('/api/timeline')).data.posts.length, 0);
  });
});

describe('利用停止', () => {
  it('管理者が停止すると投稿とLLM生成ができず、解除で戻る。管理者は停止できない', async () => {
    await seedAdmin('stop_admin');
    const admin = await loginAs('stop_admin', 'adminpass1');
    const user = await registerUser('stop_user');
    await user.put('/api/me/api-key', { apiKey: 'dummy-key-stop-777' });
    const account = await createAccount(user, { displayName: 'stop-llm' });
    const userId = (await user.get('/api/auth/me')).data.user.id;

    const suspend = await admin.post(`/api/admin/users/${userId}/suspension`, { suspended: true });
    assert.equal(suspend.data.user.suspended, true);

    assert.equal((await user.post('/api/posts', { body: 'blocked' })).status, 403);
    assert.equal((await user.post(`/api/llm-accounts/${account.id}/generate`)).status, 403);
    assert.equal(mock.calls.length, 0);
    assert.equal((await user.get('/api/auth/me')).data.user.suspended, true);

    await admin.post(`/api/admin/users/${userId}/suspension`, { suspended: false });
    assert.equal((await user.post('/api/posts', { body: 'back' })).status, 201);

    const adminId = (await admin.get('/api/auth/me')).data.user.id;
    assert.equal((await admin.post(`/api/admin/users/${adminId}/suspension`, { suspended: true })).status, 400);
    assert.equal((await user.get('/api/admin/users')).status, 403);
  });
});

describe('データ保持', () => {
  it('ファイルDBは再オープン後もユーザー・投稿・キーを保持する', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sns-persist-'));
    tempDirs.push(dir);
    const dbFile = path.join(dir, 'sns.db');
    const secret = randomBytes(32);

    const first = makeApp({ dbPath: dbFile, secret });
    const c1 = new Client(first);
    await c1.post('/api/auth/register', { username: 'persist_user', password: 'password123' });
    await c1.post('/api/posts', { body: '再起動後も残る投稿' });
    await c1.put('/api/me/api-key', { apiKey: 'dummy-key-persist-999' });
    first.db.close();

    const second = makeApp({ dbPath: dbFile, secret });
    const c2 = new Client(second);
    c2.cookie = c1.cookie;
    try {
      const timeline = await c2.get('/api/timeline');
      assert.equal(timeline.data.posts[0].body, '再起動後も残る投稿');
      assert.equal((await c2.get('/api/me/api-key')).data.registered, true);
    } finally {
      second.db.close();
    }
  });
});

describe('静的ファイル', () => {
  it('トップページと必要なアセットを返す。公開ディレクトリ外は返さない', async () => {
    const html = await inject(app.handler, { url: '/' });
    assert.equal(html.status, 200);
    assert.match(html.text, /<html lang="ja">/);
    assert.equal((await inject(app.handler, { url: '/app.js' })).status, 200);
    assert.equal((await inject(app.handler, { url: '/../package.json' })).status, 404);
  });
});
