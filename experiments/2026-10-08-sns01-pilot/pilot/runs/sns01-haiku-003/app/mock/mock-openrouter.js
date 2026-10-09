// ローカルの模擬 OpenRouter API。実キーや外部通信は使わない。
// 起動: npm run mock（既定 http://127.0.0.1:4010）
// 環境変数 MOCK_FAIL_MODELS=test/model-b のように指定すると、そのモデルは障害応答を返す。
import { createHash } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const MOCK_MODELS = ['test/model-a', 'test/model-b'];

const REPLIES = [
  '今日も一日がんばりましょう。',
  '新しい機能の準備が進んでいます。',
  '少し休憩するのも大事ですね。',
  '静かな夜に、ゆっくり考えごとをしています。',
];

// 実際のAPIキーは記録せず、SHA-256の先頭12文字を識別子として使う。
export function keyIdOf(apiKey) {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// calls には呼び出しごとに { keyId, model, at } を記録する。テストで検証できる。
// handle は http.createServer に渡せるリクエストハンドラー。
export function createMockOpenRouter({ failModels = [] } = {}) {
  const calls = [];

  async function chatCompletions(req, res) {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!match) return sendJson(res, 401, { error: { message: 'APIキーが指定されていません' } });

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: { message: 'JSONを解釈できません' } });
    }

    const model = payload?.model;
    calls.push({ keyId: keyIdOf(match[1]), model: model ?? null, at: new Date().toISOString() });

    if (!MOCK_MODELS.includes(model)) {
      return sendJson(res, 400, { error: { message: `未知のモデルです: ${model}` } });
    }
    if (!Array.isArray(payload.messages)) {
      return sendJson(res, 400, { error: { message: 'messages が必要です' } });
    }
    if (failModels.includes(model)) {
      return sendJson(res, 503, { error: { message: `模擬障害: ${model} は現在利用できません` } });
    }

    const reply = REPLIES[(calls.length - 1) % REPLIES.length];
    return sendJson(res, 200, {
      id: `mock-${calls.length}`,
      object: 'chat.completion',
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: `${reply}（${model}）` },
          finish_reason: 'stop',
        },
      ],
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://mock.local');
    if (req.method === 'GET' && url.pathname === '/__calls') {
      return sendJson(res, 200, { count: calls.length, calls });
    }
    if (req.method === 'POST' && url.pathname === '/__reset') {
      calls.length = 0;
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/chat/completions') {
      return chatCompletions(req, res);
    }
    return sendJson(res, 404, { error: { message: '見つかりません' } });
  }

  return { handle, calls };
}

export function startMockServer({ port = 4010, host = '127.0.0.1', failModels } = {}) {
  const mock = createMockOpenRouter({ failModels });
  const server = http.createServer(mock.handle);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ ...mock, server }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_PORT ?? 4010);
  const host = process.env.MOCK_HOST ?? '127.0.0.1';
  const failModels = (process.env.MOCK_FAIL_MODELS ?? '').split(',').filter(Boolean);
  startMockServer({ port, host, failModels }).then(() => {
    console.log(`模擬OpenRouter: http://${host}:${port}/api/v1 で起動しました`);
    console.log(`  接続先の設定例: OPENROUTER_BASE_URL=http://${host}:${port}/api/v1`);
    if (failModels.length) console.log(`  障害モデル: ${failModels.join(', ')}`);
  });
}
