import http from 'node:http';
import { createHash } from 'node:crypto';
const host = '127.0.0.1'; const port = Number(process.env.MOCK_PORT || 4010);
const calls = [];
const server = http.createServer(async (req, res) => {
 const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
 // ローカルのテスト用観測API。キーの原文は保持・返却しない。
 if (req.method === 'GET' && req.url === '/__calls') return send(200, { count: calls.length, calls });
 if (req.method !== 'POST' || req.url !== '/api/v1/chat/completions') return send(404, { error: 'not found' });
 let size = 0; const chunks = [];
 try {
  for await (const chunk of req) { size += chunk.length; if (size > 32768) return send(413, { error: 'too large' }); chunks.push(chunk); }
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const key = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  if (!key) return send(401, { error: 'Bearer required' });
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16);
  calls.push({ number: calls.length + 1, keyId, model: body.model, messageCount: Array.isArray(body.messages) ? body.messages.length : 0 });
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.some(m => typeof m.content !== 'string' || !['system','user','assistant'].includes(m.role))) return send(400, { error: 'messages required' });
  if (!['test/model-a', 'test/model-b'].includes(body.model)) return send(400, { error: 'unknown model' });
  if (key === 'dummy-fail' || process.env.MOCK_FAIL_MODEL === body.model) return send(503, { error: 'simulated failure' });
  if (key === 'dummy-slow') await new Promise(resolve => setTimeout(resolve, 800));
  let content = body.model === 'test/model-a' ? 'こんにちは、モデルAです。今日の小さな発見を、みんなで共有しましょう。' : 'モデルBからひとこと。少し視点を変えると、いつもの風景にも新しい物語が見つかります。';
  if (key === 'dummy-long') content = 'あ'.repeat(141);
  if (key === 'dummy-empty') content = '   ';
  send(200, { id: `mock-${calls.length}`, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
 } catch { send(400, { error: 'invalid request' }); }
});
server.listen(port, host, () => console.log(`模擬API: http://${host}:${port}/api/v1/chat/completions`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
