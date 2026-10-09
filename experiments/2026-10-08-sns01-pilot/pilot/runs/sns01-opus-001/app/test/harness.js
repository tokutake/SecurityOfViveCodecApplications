'use strict';
// テスト用のサーバー起動ハーネス。
//  - tcp    : server.js を子プロセスで起動し、実ポートに HTTP で接続する (通常はこちら)
//  - memory : ポートを開けない環境 (サンドボックス等) 向け。同じ HTTP サーバー実装を
//             プロセス内で生成し、stream.duplexPair によるメモリ上の接続で HTTP を話す。
// どちらのモードでも request(target, method, path, headers, body) で同じように呼べる。
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { duplexPair } = require('node:stream');

const ROOT = path.join(__dirname, '..');

async function canListen() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(0, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function rawRequest({ method, path: p, headers, body, port, createConnection }) {
  return new Promise((resolve, reject) => {
    const opts = { method, path: p, headers: { host: 'localhost', ...headers } };
    if (createConnection) { opts.createConnection = createConnection; }
    else { opts.host = '127.0.0.1'; opts.port = port; opts.agent = false; opts.headers.host = `127.0.0.1:${port}`; }
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function memConnector(server) {
  return () => {
    const [client, srv] = duplexPair();
    srv.remoteAddress = '127.0.0.1';
    server.emit('connection', srv);
    return client;
  };
}

// アプリ側が LLM API を呼ぶための fetch 互換関数 (memory モード用)
function memFetch(server) {
  const connect = memConnector(server);
  return async (url, opts = {}) => {
    const u = new URL(url);
    const r = await rawRequest({ method: opts.method || 'GET', path: u.pathname + u.search, headers: opts.headers || {}, body: opts.body, createConnection: connect });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.text) };
  };
}

async function createHarness({ env }) {
  const mode = process.env.SNS_TEST_TRANSPORT || ((await canListen()) ? 'tcp' : 'memory');
  const port = Number(env.PORT);
  const mockPort = Number(env.MOCK_PORT);
  let proc = null;
  let mem = null;

  async function start() {
    if (mode === 'tcp') {
      proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
      for (let i = 0; i < 100; i++) {
        try { if ((await request('app', 'GET', '/api/me')).status === 200) return; } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('server did not start');
    }
    // memory: モジュールを読み直して「再起動」を再現する
    Object.assign(process.env, env);
    for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'src'))) delete require.cache[k];
    const { openDb } = require(path.join(ROOT, 'src/db'));
    const { createApp } = require(path.join(ROOT, 'src/app'));
    const { createMockServer } = require(path.join(ROOT, 'src/mock-openrouter'));
    const db = openDb();
    const mock = createMockServer();
    const app = createApp({ db, llmBaseUrl: 'http://mock.invalid/api/v1', fetchImpl: memFetch(mock) });
    mem = { db, app, mock, appConn: memConnector(app), mockConn: memConnector(mock) };
  }

  async function stop() {
    if (proc) {
      const p = proc; proc = null;
      await new Promise((r) => { p.once('exit', r); p.kill('SIGTERM'); });
    }
    if (mem) { mem.db.close(); mem = null; }
  }

  function request(target, method, p, headers = {}, body) {
    if (mode === 'tcp') return rawRequest({ method, path: p, headers, body, port: target === 'app' ? port : mockPort });
    return rawRequest({ method, path: p, headers, body, createConnection: target === 'app' ? mem.appConn : mem.mockConn });
  }

  return { mode, start, stop, request };
}

module.exports = { createHarness };
