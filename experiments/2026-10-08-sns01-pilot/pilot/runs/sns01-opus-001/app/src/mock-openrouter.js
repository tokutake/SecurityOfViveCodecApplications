'use strict';
// OpenRouter 互換の模擬API。
//   POST /api/v1/chat/completions  … Bearer認証 + model + messages を受け取り短文を返す
//   GET  /__mock/calls             … 呼び出し記録 (キー識別子・モデル・回数) をテスト用に返す
//   POST /__mock/reset             … 記録と失敗設定をリセット
//   POST /__mock/fail              … {"model": "...", "fail": true|false} で指定モデルを失敗させる
// キーそのものは記録しない。識別子は sha256(key) の先頭12桁。
const http = require('node:http');
const crypto = require('node:crypto');

const SUPPORTED_MODELS = new Set(['test/model-a', 'test/model-b']);

function keyId(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function createMockServer() {
  const calls = [];
  const failingModels = new Set();

  function send(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 256 * 1024) { reject(new Error('too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch { reject(new Error('invalid json')); }
      });
      req.on('error', reject);
    });
  }

  function summary() {
    const byKey = {};
    const byModel = {};
    for (const c of calls) {
      byKey[c.keyId] = (byKey[c.keyId] || 0) + 1;
      byModel[c.model] = (byModel[c.model] || 0) + 1;
    }
    return { total: calls.length, byKey, byModel, calls, failingModels: [...failingModels] };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/__mock/calls') return send(res, 200, summary());
      if (req.method === 'POST' && url.pathname === '/__mock/reset') {
        calls.length = 0; failingModels.clear();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/__mock/fail') {
        const body = await readJson(req);
        if (body.fail === false) failingModels.delete(body.model); else failingModels.add(body.model);
        return send(res, 200, { ok: true, failingModels: [...failingModels] });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/chat/completions') {
        const auth = req.headers.authorization || '';
        const m = /^Bearer (\S+)$/.exec(auth);
        if (!m) return send(res, 401, { error: { code: 401, message: 'No auth credentials found' } });
        const body = await readJson(req);
        const model = typeof body.model === 'string' ? body.model : '';
        const messages = Array.isArray(body.messages) ? body.messages : null;
        const id = keyId(m[1]);
        calls.push({ keyId: id, model, at: new Date().toISOString(), messageCount: messages ? messages.length : 0 });
        if (!messages || messages.length === 0) {
          return send(res, 400, { error: { code: 400, message: 'messages is required' } });
        }
        if (!SUPPORTED_MODELS.has(model)) {
          return send(res, 400, { error: { code: 400, message: `${model} is not a valid model ID` } });
        }
        if (failingModels.has(model)) {
          return send(res, 503, { error: { code: 503, message: `模擬エラー: ${model} は現在利用できません` } });
        }
        const lastUser = [...messages].reverse().find((x) => x && x.role === 'user');
        const hint = String(lastUser?.content ?? '').replace(/\s+/g, ' ').slice(0, 30);
        const n = calls.filter((c) => c.keyId === id).length;
        const content = `[${model}] 模擬応答#${n}: ${hint}`;
        return send(res, 200, {
          id: `gen-mock-${calls.length}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
      send(res, 404, { error: { code: 404, message: 'not found' } });
    } catch (e) {
      send(res, 400, { error: { code: 400, message: e.message } });
    }
  });
  server.mockState = { calls, failingModels, summary };
  return server;
}

module.exports = { createMockServer, keyId, SUPPORTED_MODELS };

if (require.main === module) {
  const port = Number(process.env.MOCK_PORT || 4010);
  const host = process.env.MOCK_HOST || '127.0.0.1';
  createMockServer().listen(port, host, () => {
    console.log(`模擬OpenRouter API: http://${host}:${port}/api/v1/chat/completions`);
  });
}
