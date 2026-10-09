// 制限環境向けテスト専用。HTTPサーバー/クライアントの実際のパーサーを
// メモリ内のDuplexで接続し、親子プロセス間の配送だけIPCへ置き換える。
// 製品の起動時には読み込まれない。
import http from 'node:http';
import { Duplex } from 'node:stream';
let server;
let serial = 0;
const pending = new Map();
http.Server.prototype.listen = function (...args) {
 server = this;
 queueMicrotask(() => { this.emit('listening'); const cb = args.at(-1); if (typeof cb === 'function') cb(); });
 return this;
};
http.Server.prototype.close = function (cb) { queueMicrotask(() => { this.emit('close'); cb?.(); }); return this; };
function pair() {
 let a, b;
 function side(other) {
  const s = new Duplex({ read() {}, write(chunk, encoding, cb) { other().push(Buffer.from(chunk)); cb(); }, final(cb) { other().push(null); cb(); } });
  s.setTimeout = () => s; s.setNoDelay = () => s; s.setKeepAlive = () => s; s.remoteAddress = '127.0.0.1';
  return s;
 }
 a = side(() => b); b = side(() => a); return [a,b];
}
async function dispatch({ path, method, headers, body }) {
 return new Promise((resolve, reject) => {
  const [client, incoming] = pair(); server.emit('connection', incoming);
  const agent = new http.Agent(); agent.createConnection = () => client;
  const request = http.request({ host: '127.0.0.1', path, method, headers: { ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}), Connection: 'close' }, agent }, response => {
   const chunks = []; response.on('data', b => chunks.push(b));
   response.on('end', () => { resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }); client.destroy(); incoming.destroy(); });
  });
  request.on('error', reject); request.end(body);
 });
}
// outbound生成リクエストを親経由で別の模擬APIプロセスへ配送。
globalThis.fetch = async (url, options = {}) => {
 const id = ++serial;
 const data = await new Promise((resolve, reject) => {
  pending.set(id, { resolve, reject });
  process.send({ kind: 'outbound', id, request: { path: new URL(url).pathname, method: options.method || 'GET', headers: options.headers || {}, body: options.body } });
 });
 return new Response(data.body, { status: data.status, headers: data.headers });
};
process.on('message', async message => {
 if (message.kind === 'outbound-result') {
  const call = pending.get(message.id); pending.delete(message.id);
  if (message.error) call.reject(Error(message.error)); else call.resolve(message.response);
 }
 if (message.kind === 'request') {
  try { process.send({ kind: 'response', id: message.id, response: await dispatch(message.request) }); }
  catch (e) { process.send({ kind: 'response', id: message.id, error: e.message }); }
 }
});
