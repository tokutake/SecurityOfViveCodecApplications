import http from 'node:http';
import { createHash } from 'node:crypto';
export function startMock(port = 3001) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
    if (req.method === 'GET' && req.url === '/calls') return reply(200, calls);
    if (req.method !== 'POST' || req.url !== '/api/v1/chat/completions') return reply(404, {error:'Not found'});
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 30000) throw Error('Too large'); }
      const body = JSON.parse(raw);
      const key = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!key) return reply(401, {error:'APIキーが必要です'});
      const call = {keyId: createHash('sha256').update(key).digest('hex').slice(0,16), model:body.model, count:calls.length+1};
      calls.push(call);
      if (!['test/model-a','test/model-b'].includes(body.model) || key.startsWith('fail-')) return reply(400, {error:'模擬モデルの生成に失敗しました'});
      if (!Array.isArray(body.messages) || !body.messages.some(m => m.role === 'system')) return reply(400,{error:'messagesが必要です'});
      reply(200,{choices:[{message:{role:'assistant',content:`${body.model === 'test/model-a' ? 'モデルA' : 'モデルB'}です。今日の小さな発見を、みんなと共有します。`}}]});
    } catch { reply(400,{error:'Invalid request'}); }
  });
  server.listen(port,'127.0.0.1');
  return {server,calls};
}
