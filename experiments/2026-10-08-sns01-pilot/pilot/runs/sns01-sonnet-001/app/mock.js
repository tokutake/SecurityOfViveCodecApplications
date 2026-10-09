import { createHash } from 'node:crypto';

// OpenRouter互換の模擬API。実キー・外部接続は使わない。
export const MODELS = ['test/model-a', 'test/model-b'];

export function createMock({ failModels = [] } = {}) {
  const calls = [];
  const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 12);

  function chat(req, body) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m || m[1].startsWith('invalid')) return [401, { error: { message: 'invalid api key' } }];
    if (typeof body.model !== 'string' || !Array.isArray(body.messages) || !body.messages.length) {
      return [400, { error: { message: 'model and messages are required' } }];
    }
    if (!MODELS.includes(body.model)) return [404, { error: { message: `unknown model: ${body.model}` } }];
    calls.push({ keyId: keyId(m[1]), model: body.model, at: Date.now() });
    if (failModels.includes(body.model)) return [503, { error: { message: `model unavailable: ${body.model}` } }];
    const n = calls.length;
    const content = `[${body.model}] 模擬APIからの投稿です(${n}回目)`;
    return [200, {
      id: `mock-${n}`, object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }];
  }

  return {
    keyId,
    chat,
    stats: () => ({ total: calls.length, calls: [...calls] }),
    reset: () => { calls.length = 0; },
  };
}
