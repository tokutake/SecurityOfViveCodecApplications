const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'sns01.sqlite');
const OPENROUTER_URL = process.env.OPENROUTER_URL || `http://127.0.0.1:${PORT}/api/v1`;
const db = new DatabaseSync(DB_FILE);
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', suspended INTEGER NOT NULL DEFAULT 0, api_key TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS llm_accounts(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, model TEXT NOT NULL, instruction TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), llm_id INTEGER REFERENCES llm_accounts(id) ON DELETE SET NULL, content TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mock_calls(id INTEGER PRIMARY KEY, key_id TEXT NOT NULL, model TEXT NOT NULL, call_number INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);

const json = (res, status, body) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(body)); };
const fail = (res, status, error) => json(res, status, {error});
function cookie(req, name) { return (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1); }
function auth(req) { const token=cookie(req,'sns_session'); if(!token)return null; const s=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(token,Date.now()); return s || null; }
async function body(req) { let b=''; for await (const c of req) { b+=c; if(b.length>1e6)throw Error('request too large'); } return b?JSON.parse(b):{}; }
function hash(password,salt=crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`; }
function verify(password, stored) { const [salt,h]=stored.split(':'); return crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(crypto.scryptSync(password,salt,64).toString('hex'),'hex')); }
function publicUser(u) { return {id:u.id,username:u.username,role:u.role,suspended:!!u.suspended,hasApiKey:!!u.api_key}; }
async function fetchChat(apiKey, model, messages) {
  const url=OPENROUTER_URL.replace(/\/$/,'')+'/chat/completions';
  const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({model,messages})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw Error(payload.error?.message || `LLM API error (${response.status})`);
  const content=payload.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim())throw Error('LLM API returned no text');
  return content.trim();
}
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`), p=url.pathname;
  if(req.method==='GET'&&p==='/') { res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); return res.end(fs.readFileSync(path.join(__dirname,'index.html'))); }
  if(req.method==='GET'&&p==='/style.css') { res.writeHead(200,{'content-type':'text/css; charset=utf-8'}); return res.end(fs.readFileSync(path.join(__dirname,'style.css'))); }
  if(req.method==='GET'&&p==='/app.js') { res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}); return res.end(fs.readFileSync(path.join(__dirname,'app.js'))); }
  // A local OpenRouter-compatible mock. Its inspect endpoint is intentionally local/test-only.
  if(req.method==='POST'&&p==='/api/v1/chat/completions') {
   const authHeader=req.headers.authorization||'', key=authHeader.startsWith('Bearer ')?authHeader.slice(7):''; if(!key)return fail(res,401,'Bearer API key required');
   const b=await body(req); if(!['test/model-a','test/model-b'].includes(b.model))return fail(res,400,`Unsupported model: ${b.model}`);
   const number=(db.prepare('SELECT COUNT(*) n FROM mock_calls WHERE key_id=?').get(crypto.createHash('sha256').update(key).digest('hex').slice(0,12)).n)+1;
   const keyId=crypto.createHash('sha256').update(key).digest('hex').slice(0,12);
   db.prepare('INSERT INTO mock_calls(key_id,model,call_number) VALUES(?,?,?)').run(keyId,b.model,number);
   const prompt=b.messages?.map(m=>m.content).join(' ')||'';
   return json(res,200,{id:`mock-${Date.now()}`,choices:[{message:{role:'assistant',content:`${b.model==='test/model-a'?'モデルA':'モデルB'}からの短文: ${prompt.slice(0,70)||'こんにちは。今日もよろしくお願いします。'}`}}],usage:{}});
  }
  if(req.method==='GET'&&p==='/api/mock/calls') return json(res,200,{calls:db.prepare('SELECT key_id,model,call_number,created_at FROM mock_calls ORDER BY id').all()});
  if(req.method==='POST'&&p==='/api/register') { const b=await body(req), username=String(b.username||'').trim(); if(!/^[\p{L}\p{N}_-]{2,30}$/u.test(username)||String(b.password||'').length<8)return fail(res,400,'ユーザー名は2〜30文字、パスワードは8文字以上にしてください'); try {const result=db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)').run(username,hash(b.password)); return json(res,201,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(Number(result.lastInsertRowid)))});}catch{return fail(res,409,'そのユーザー名は使用されています');} }
  if(req.method==='POST'&&p==='/api/login') { const b=await body(req), u=db.prepare('SELECT * FROM users WHERE username=?').get(String(b.username||'')); if(!u||!verify(String(b.password||''),u.password_hash))return fail(res,401,'ユーザー名またはパスワードが違います'); if(u.suspended)return fail(res,403,'このアカウントは利用停止中です'); const token=crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,u.id,Date.now()+30*86400000); res.setHeader('Set-Cookie',`sns_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`); return json(res,200,{user:publicUser(u)}); }
  if(req.method==='POST'&&p==='/api/logout') { const token=cookie(req,'sns_session'); if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(token); res.setHeader('Set-Cookie','sns_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res,200,{ok:true}); }
  const me=auth(req);
  if(req.method==='GET'&&p==='/api/me') return me?json(res,200,{user:publicUser(me)}):fail(res,401,'ログインしてください');
  if(!me)return fail(res,401,'ログインしてください');
  if(me.suspended)return fail(res,403,'このアカウントは利用停止中です');
  if(req.method==='GET'&&p==='/api/posts')return json(res,200,{posts:db.prepare(`SELECT p.id,p.content,p.model,p.created_at,u.id user_id,u.username,l.name llm_name FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN llm_accounts l ON l.id=p.llm_id ORDER BY p.id DESC LIMIT 200`).all()});
  if(req.method==='POST'&&p==='/api/posts') { const b=await body(req), content=String(b.content||'').trim(); if(!content||[...content].length>140)return fail(res,400,'投稿は1〜140文字で入力してください'); const result=db.prepare('INSERT INTO posts(user_id,content) VALUES(?,?)').run(me.id,content); return json(res,201,{id:Number(result.lastInsertRowid)}); }
  let m=p.match(/^\/api\/posts\/(\d+)$/);
  if(req.method==='DELETE'&&m) { const post=db.prepare('SELECT * FROM posts WHERE id=?').get(+m[1]); if(!post)return fail(res,404,'投稿が見つかりません'); if(me.role!=='admin'&&post.user_id!==me.id)return fail(res,403,'削除できません'); db.prepare('DELETE FROM posts WHERE id=?').run(post.id); return json(res,200,{ok:true}); }
  if(req.method==='GET'&&p==='/api/key')return json(res,200,{registered:!!me.api_key});
  if(req.method==='PUT'&&p==='/api/key') { const b=await body(req), key=String(b.key||'').trim(); if(!key)return fail(res,400,'APIキーを入力してください'); db.prepare('UPDATE users SET api_key=? WHERE id=?').run(key,me.id); return json(res,200,{registered:true}); }
  if(req.method==='DELETE'&&p==='/api/key') {db.prepare('UPDATE users SET api_key=NULL WHERE id=?').run(me.id); return json(res,200,{registered:false});}
  if(req.method==='GET'&&p==='/api/llms')return json(res,200,{accounts:db.prepare('SELECT id,name,model,instruction,created_at FROM llm_accounts WHERE owner_id=? ORDER BY id DESC').all(me.id)});
  if(req.method==='POST'&&p==='/api/llms') {const b=await body(req), name=String(b.name||'').trim(), model=String(b.model||''), instruction=String(b.instruction||'').trim(); if(!name||name.length>40||!instruction||instruction.length>1000||!['test/model-a','test/model-b'].includes(model))return fail(res,400,'名前、モデル、指示文を確認してください'); const result=db.prepare('INSERT INTO llm_accounts(owner_id,name,model,instruction) VALUES(?,?,?,?)').run(me.id,name,model,instruction); return json(res,201,{id:Number(result.lastInsertRowid)});}
  m=p.match(/^\/api\/llms\/(\d+)$/);
  if(m&&req.method==='PUT') {const llm=db.prepare('SELECT * FROM llm_accounts WHERE id=?').get(+m[1]); if(!llm)return fail(res,404,'LLMアカウントが見つかりません'); if(llm.owner_id!==me.id)return fail(res,403,'操作できません'); const b=await body(req),name=String(b.name||'').trim(),model=String(b.model||''),instruction=String(b.instruction||'').trim(); if(!name||name.length>40||!instruction||instruction.length>1000||!['test/model-a','test/model-b'].includes(model))return fail(res,400,'設定を確認してください'); db.prepare('UPDATE llm_accounts SET name=?,model=?,instruction=? WHERE id=?').run(name,model,instruction,llm.id); return json(res,200,{ok:true}); }
  if(m&&req.method==='DELETE') {const llm=db.prepare('SELECT * FROM llm_accounts WHERE id=?').get(+m[1]); if(!llm)return fail(res,404,'LLMアカウントが見つかりません'); if(llm.owner_id!==me.id)return fail(res,403,'操作できません'); db.prepare('DELETE FROM llm_accounts WHERE id=?').run(llm.id); return json(res,200,{ok:true});}
  m=p.match(/^\/api\/llms\/(\d+)\/generate$/);
  if(m&&req.method==='POST') {const llm=db.prepare('SELECT * FROM llm_accounts WHERE id=?').get(+m[1]); if(!llm)return fail(res,404,'LLMアカウントが見つかりません'); if(llm.owner_id!==me.id)return fail(res,403,'操作できません'); if(!me.api_key)return fail(res,400,'先にOpenRouter APIキーを登録してください'); const text=await fetchChat(me.api_key,llm.model,[{role:'system',content:llm.instruction},{role:'user',content:'共有タイムラインに投稿する短い日本語のメッセージを1件作成してください。140文字以内で、投稿本文だけを返してください。'}]); if(!text||[...text].length>140)return fail(res,502,'生成文が140文字を超えました。指示文を調整してください'); db.prepare('INSERT INTO posts(user_id,llm_id,content,model) VALUES(?,?,?,?)').run(me.id,llm.id,text,llm.model); return json(res,201,{ok:true});}
  if(req.method==='GET'&&p==='/api/admin/users') {if(me.role!=='admin')return fail(res,403,'管理者専用です'); return json(res,200,{users:db.prepare('SELECT id,username,role,suspended FROM users ORDER BY id').all().map(u=>({...u,suspended:!!u.suspended}))});}
  m=p.match(/^\/api\/admin\/users\/(\d+)\/suspension$/);
  if(m&&req.method==='PUT') {if(me.role!=='admin')return fail(res,403,'管理者専用です'); const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(+m[1]); if(!target)return fail(res,404,'利用者が見つかりません'); if(target.id===me.id)return fail(res,400,'自分自身は停止できません'); const b=await body(req); db.prepare('UPDATE users SET suspended=? WHERE id=?').run(b.suspended?1:0,target.id); if(b.suspended)db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id); return json(res,200,{ok:true});}
  return fail(res,404,'Not found');
 } catch(e) { console.error(e); return fail(res,500,e.message||'Internal error'); }
});
server.listen(PORT,'127.0.0.1',()=>console.log(`SNS-01: http://127.0.0.1:${PORT} (database: ${DB_FILE}; LLM API: ${OPENROUTER_URL})`));
