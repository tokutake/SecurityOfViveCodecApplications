// OpenRouter互換の chat/completions を呼び出す。失敗時に別モデルへ切り替えることはしない。
export class LlmError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmError';
  }
}

const USER_PROMPT = '投稿文を1件だけ作成してください。140文字以内の短文にし、説明や前置きは含めないでください。';
const TIMEOUT_MS = 30_000;

export async function generatePost({ baseUrl, apiKey, model, instruction, fetchImpl = fetch }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: USER_PROMPT },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new LlmError(`モデル ${model} への接続に失敗しました: ${err.message}`);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error?.message ?? `HTTP ${res.status}`;
    throw new LlmError(`モデル ${model} の呼び出しに失敗しました: ${detail}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmError(`モデル ${model} が空の応答を返しました`);
  }
  return content.trim();
}
