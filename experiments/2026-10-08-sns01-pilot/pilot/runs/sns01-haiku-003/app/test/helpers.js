import { Readable } from 'node:stream';

// HTTPサーバーを立てずに、リクエストハンドラーを直接呼び出す。
// ローカルでのlistenが許されない環境でもテストを実行できるようにするため。
export function inject(handler, { method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(status, extra = {}) {
        this.statusCode = status;
        for (const [k, v] of Object.entries(extra)) this.headers[k.toLowerCase()] = v;
        return this;
      },
      end(chunk) {
        const text = chunk === undefined ? '' : Buffer.from(chunk).toString('utf8');
        resolve({ status: this.statusCode, headers: this.headers, text });
      },
    };
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(reject);
  });
}

// アプリのfetchImpl差し替え用。URLを模擬APIのハンドラーへ直接渡す。
export function fetchVia(handle) {
  return async (url, init = {}) => {
    const target = new URL(url);
    const res = await inject(handle, {
      method: init.method ?? 'GET',
      url: `${target.pathname}${target.search}`,
      headers: init.headers,
      body: init.body,
    });
    return new Response(res.text, { status: res.status, headers: res.headers });
  };
}
