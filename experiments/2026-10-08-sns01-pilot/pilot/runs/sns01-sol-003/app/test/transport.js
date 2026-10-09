// ソケット待ち受けが禁止された環境向け。実際のHTTPリクエストハンドラーを呼ぶ。
import http from 'node:http';
import { Readable } from 'node:stream';
const servers = new Map();
export function installTransport() {
 const originalListen=http.Server.prototype.listen;
 const originalFetch=globalThis.fetch;
 http.Server.prototype.listen=function(port,host,callback){servers.set(Number(port),this);queueMicrotask(()=>{this.emit('listening');callback?.();});return this;};
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input);const server=servers.get(Number(url.port));if(!server)throw Error('Unknown virtual port');
  const headers=Object.fromEntries(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));headers.host=url.host;
  const req=Readable.from(options.body?[Buffer.from(options.body)]:[]);req.url=url.pathname+url.search;req.method=options.method||'GET';req.headers=headers;
  return new Promise((resolve,reject)=>{const outputHeaders=new Headers();let status=200;
   const res={setHeader(k,v){outputHeaders.set(k,v);},writeHead(code,values={}){status=code;for(const [k,v] of Object.entries(values))outputHeaders.set(k,v);},end(body=''){resolve(new Response(body,{status,headers:outputHeaders}));}};
   try{server.emit('request',req,res);}catch(e){reject(e);}
  });
 };
 return ()=>{http.Server.prototype.listen=originalListen;globalThis.fetch=originalFetch;servers.clear();};
}
