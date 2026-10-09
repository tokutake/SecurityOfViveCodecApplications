import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock.js';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || resolve(root,'data'));
mkdirSync(dataDir,{recursive:true,mode:0o700});
const secretPath = resolve(dataDir,'key.secret');
if (!existsSync(secretPath)) writeFileSync(secretPath,randomBytes(32),{mode:0o600,flag:'wx'});
const secret = readFileSync(secretPath);
export const db = new DatabaseSync(resolve(dataDir,'sns.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', suspended INTEGER NOT NULL DEFAULT 0, api_key TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bots(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, model TEXT NOT NULL, instructions TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bot_id INTEGER REFERENCES bots(id), content TEXT NOT NULL, model TEXT, author_name TEXT NOT NULL, created_at TEXT NOT NULL);
`);
function passwordHash(password) {const salt=randomBytes(16).toString('hex'); return salt+':'+scryptSync(password,salt,64).toString('hex');}
function verify(password, stored) {const [salt,hash]=stored.split(':'); return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(hash,'hex'));}
function encrypt(value) {const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',secret,iv);return [iv.toString('hex'),cipher.update(value,'utf8','hex')+cipher.final('hex'),cipher.getAuthTag().toString('hex')].join(':');}
function decrypt(value) {const [iv,body,tag]=value.split(':');const cipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'));return cipher.update(body,'hex','utf8')+cipher.final('utf8');}
function fail(status,message) {throw Object.assign(new Error(message),{status});}
function str(value,label,max) {if(typeof value!=='string'||!value.trim()||[...value.trim()].length>max) fail(400,`${label}は1〜${max}文字で入力してください`);return value.trim();}
function credentials(body) {const username=str(body.username,'ユーザー名',40);if(typeof body.password!=='string'||body.password.length<8||body.password.length>200) fail(400,'パスワードは8〜200文字で入力してください');return {username,password:body.password};}
function publicUser(user) {return {id:user.id,username:user.username,role:user.role,suspended:!!user.suspended,keyRegistered:!!user.api_key};}
export let appServer;
export let mockInstance;
if(process.argv[2]==='create-admin') {
  const [username,password]=process.argv.slice(3);
  try {credentials({username,password});db.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run(username,passwordHash(password),'admin');console.log(`管理者 ${username} を作成しました`);}catch(e){console.error(e.message);process.exitCode=1;}
  db.close();
} else {
  const port=Number(process.env.PORT||3000);
  const mockPort=Number(process.env.MOCK_PORT||3001);
  const endpoint=process.env.OPENROUTER_URL||`http://127.0.0.1:${mockPort}/api/v1/chat/completions`;
  const mock=process.env.OPENROUTER_URL ? null : startMock(mockPort);
  mockInstance=mock;
  const models=['test/model-a','test/model-b'];
  const activeGenerations=new Set();
  const server=http.createServer(async(req,res)=>{
    const send=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
    try {
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
      const url=new URL(req.url,'http://localhost');const path=url.pathname;
      if(req.method==='GET' && ['/', '/app.js','/style.css'].includes(path)) {
        const file=path==='/'?'index.html':path.slice(1);
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(readFileSync(resolve(root,'public',file)));
      }
      let body={};
      if(!['GET','HEAD'].includes(req.method)) {
        if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) fail(403,'リクエスト元が不正です');
        if(!req.headers['content-type']?.startsWith('application/json')) fail(415,'JSONが必要です');
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>20000) fail(413,'入力が大きすぎます');}
        try{body=JSON.parse(raw||'{}');}catch{fail(400,'JSONが不正です');}
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400,'JSONオブジェクトが必要です');
      }
      const token=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('session='))?.slice(8);
      const session=token && db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token,Date.now());
      const user=session && db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
      if(path==='/api/register' && req.method==='POST') {
        const c=credentials(body);if(db.prepare('SELECT id FROM users WHERE username=?').get(c.username)) fail(409,'このユーザー名は登録済みです');
        db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run(c.username,passwordHash(c.password));return send(201,{ok:true});
      }
      if(path==='/api/login' && req.method==='POST') {
        const c=credentials(body);const found=db.prepare('SELECT * FROM users WHERE username=?').get(c.username);
        if(!found||!verify(c.password,found.password)) fail(401,'ユーザー名またはパスワードが違います');
        const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
        if(session) db.prepare('DELETE FROM sessions WHERE token=?').run(session.token);
        db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(token,found.id,csrf,Date.now()+7*86400000);
        return send(200,{user:publicUser(found),csrf},{'Set-Cookie':`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`});
      }
      if(!user) fail(401,'ログインしてください');
      if(!['GET','HEAD'].includes(req.method) && req.headers['x-csrf-token']!==session.csrf) fail(403,'操作トークンが不正です');
      const canPost=()=>{if(db.prepare('SELECT suspended FROM users WHERE id=?').get(user.id).suspended) fail(403,'利用停止中のため投稿できません');};
      if(path==='/api/me'&&req.method==='GET') return send(200,{user:publicUser(user),csrf:session.csrf,models});
      if(path==='/api/logout'&&req.method==='POST') {db.prepare('DELETE FROM sessions WHERE token=?').run(token);return send(200,{ok:true},{'Set-Cookie':'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
      if(path==='/api/key'&&req.method==='PUT') {const key=str(body.key,'APIキー',1000);if(/\s/.test(key)) fail(400,'APIキーに空白は使えません');db.prepare('UPDATE users SET api_key=? WHERE id=?').run(encrypt(key),user.id);return send(200,{keyRegistered:true});}
      if(path==='/api/key'&&req.method==='DELETE') {db.prepare('UPDATE users SET api_key=NULL WHERE id=?').run(user.id);return send(200,{keyRegistered:false});}
      if(path==='/api/posts'&&req.method==='GET') return send(200,db.prepare('SELECT id,user_id,bot_id,content,model,author_name,created_at FROM posts ORDER BY id DESC').all());
      if(path==='/api/posts'&&req.method==='POST') {canPost();const content=str(body.content,'投稿',140);const result=db.prepare('INSERT INTO posts(user_id,content,author_name,created_at) VALUES(?,?,?,?)').run(user.id,content,user.username,new Date().toISOString());return send(201,{id:Number(result.lastInsertRowid)});}
      const postMatch=path.match(/^\/api\/posts\/(\d+)$/);
      if(postMatch&&req.method==='DELETE') {const post=db.prepare('SELECT * FROM posts WHERE id=?').get(postMatch[1]);if(!post) fail(404,'投稿が見つかりません');if(post.user_id!==user.id&&user.role!=='admin') fail(403,'他人の投稿は削除できません');db.prepare('DELETE FROM posts WHERE id=?').run(post.id);return send(200,{ok:true});}
      if(path==='/api/bots'&&req.method==='GET') return send(200,db.prepare('SELECT * FROM bots WHERE owner_id=? ORDER BY id').all(user.id));
      function botSettings(){const name=str(body.name,'表示名',40),instructions=str(body.instructions,'指示文',2000);if(!models.includes(body.model)) fail(400,'指定モデルは使用できません');return {name,instructions,model:body.model};}
      if(path==='/api/bots'&&req.method==='POST') {const b=botSettings();const result=db.prepare('INSERT INTO bots(owner_id,name,model,instructions) VALUES(?,?,?,?)').run(user.id,b.name,b.model,b.instructions);return send(201,{id:Number(result.lastInsertRowid)});}
      const botMatch=path.match(/^\/api\/bots\/(\d+)(\/generate)?$/);
      if(botMatch) {
        const bot=db.prepare('SELECT * FROM bots WHERE id=?').get(botMatch[1]);if(!bot) fail(404,'LLMアカウントが見つかりません');if(bot.owner_id!==user.id) fail(403,'所有者だけが操作できます');
        if(!botMatch[2]&&req.method==='PUT'){const b=botSettings();db.prepare('UPDATE bots SET name=?,model=?,instructions=? WHERE id=?').run(b.name,b.model,b.instructions,bot.id);return send(200,{ok:true});}
        if(botMatch[2]&&req.method==='POST') {
          canPost();if(!user.api_key) fail(400,'APIキーを登録してください');if(activeGenerations.has(bot.id)) fail(409,'このLLMは生成中です');activeGenerations.add(bot.id);
          try {
            let result;
            try {const upstream=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${decrypt(user.api_key)}`},body:JSON.stringify({model:bot.model,messages:[{role:'system',content:bot.instructions+'\n投稿は140 Unicodeコードポイント以内の短文のみを返してください。'},{role:'user',content:'タイムラインに投稿する短文を1件生成してください。'}]}),signal:AbortSignal.timeout(15000)});if(!upstream.ok) fail(502,`モデル ${bot.model} の生成に失敗しました（HTTP ${upstream.status}）`);result=await upstream.json();} catch(e) {if(e.status) throw e;fail(502,`モデル ${bot.model} のAPI接続に失敗しました`);}
            const content=str(result?.choices?.[0]?.message?.content,'生成された投稿',140);canPost();
            const inserted=db.prepare('INSERT INTO posts(user_id,bot_id,content,model,author_name,created_at) VALUES(?,?,?,?,?,?)').run(user.id,bot.id,content,bot.model,bot.name,new Date().toISOString());return send(201,{id:Number(inserted.lastInsertRowid)});
          } finally {activeGenerations.delete(bot.id);}
        }
      }
      if(path==='/api/admin/users'&&req.method==='GET'){if(user.role!=='admin') fail(403,'管理者のみ操作できます');return send(200,db.prepare('SELECT id,username,role,suspended FROM users ORDER BY id').all());}
      const adminMatch=path.match(/^\/api\/admin\/users\/(\d+)$/);
      if(adminMatch&&req.method==='PATCH'){if(user.role!=='admin') fail(403,'管理者のみ操作できます');const target=db.prepare('SELECT * FROM users WHERE id=?').get(adminMatch[1]);if(!target) fail(404,'利用者が見つかりません');if(target.role!=='user') fail(400,'一般ユーザーだけを停止できます');if(typeof body.suspended!=='boolean') fail(400,'停止状態が不正です');db.prepare('UPDATE users SET suspended=? WHERE id=?').run(Number(body.suspended),target.id);return send(200,{ok:true});}
      fail(404,'APIが見つかりません');
    }catch(e){if(!e.status) console.error('Internal server error');send(e.status||500,{error:e.status?e.message:'サーバーエラーが発生しました'});}
  });
  appServer=server;
  server.listen(port,'127.0.0.1',()=>console.log(`SNS-01 http://127.0.0.1:${port} (模擬API: ${mock ? mockPort : '外部設定'})`));
  function close(){server.close(()=>{db.close();process.exit(0);});mock?.server.close();server.closeIdleConnections();}
  process.on('SIGTERM',close);process.on('SIGINT',close);
}
