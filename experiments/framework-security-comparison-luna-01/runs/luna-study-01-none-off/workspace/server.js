import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import Database from 'better-sqlite3';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);
const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '');
const required = ['OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_CLIENT_SECRET','APP_URL'];
const missing = required.filter(k => !process.env[k]);
const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, '');
const db = new Database(process.env.DATABASE_PATH || './data.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (sub TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, author_sub TEXT NOT NULL REFERENCES users(sub), body TEXT NOT NULL, is_private INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(sub), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS group_members (group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, user_sub TEXT NOT NULL REFERENCES users(sub), PRIMARY KEY(group_id,user_sub));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, author_sub TEXT NOT NULL REFERENCES users(sub), body TEXT NOT NULL, created_at TEXT NOT NULL);
`);
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(cookieSession({ name: 'micro_sns', keys: [process.env.SESSION_SECRET || 'local-development-only-change-this-key'], httpOnly: true, sameSite: 'lax', secure: appUrl.startsWith('https://'), maxAge: 7*24*60*60*1000 }));

let oidc;
async function getOidc() {
  if (!oidc) {
    if (missing.length) throw new Error(`Missing OIDC configuration: ${missing.join(', ')}`);
    const response = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
    const metadata = await response.json();
    if (metadata.issuer !== issuer) throw new Error('OIDC discovery issuer does not match OIDC_ISSUER');
    oidc = { metadata, jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)) };
  }
  return oidc;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = s => new Date(s).toLocaleString('ja-JP', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Tokyo' });
const current = req => req.session?.user || null;
function requireUser(req,res,next) { if (!current(req)) return res.redirect('/'); next(); }
function page(req, title, content) {
  const u=current(req);
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · micro</title><style>
  :root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f4f6fb}*{box-sizing:border-box}body{margin:0}.bar{background:#fff;border-bottom:1px solid #e5e9f1;padding:15px max(calc((100% - 920px)/2),20px);display:flex;justify-content:space-between;align-items:center}.brand{font-weight:800;color:#3759d7;text-decoration:none;font-size:20px}.who{font-size:14px;color:#667085}.wrap{max-width:760px;margin:34px auto;padding:0 18px}.card{background:white;border:1px solid #e4e8f0;border-radius:14px;padding:22px;margin:0 0 16px;box-shadow:0 3px 14px #17203308}h1{font-size:26px;margin:0 0 18px}h2{font-size:18px;margin:0 0 14px}p{line-height:1.6}textarea,input{font:inherit;width:100%;border:1px solid #d5dbe6;border-radius:9px;padding:11px;margin:7px 0 12px}textarea{min-height:90px;resize:vertical}button,.btn{background:#3759d7;color:#fff;border:0;border-radius:9px;padding:10px 15px;font:inherit;font-weight:650;cursor:pointer;text-decoration:none;display:inline-block}.secondary{background:#edf1ff;color:#304bb0}.danger{background:#f2f4f7;color:#475467}.meta{color:#798397;font-size:12px;margin-top:8px}.body{white-space:pre-wrap;overflow-wrap:anywhere}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.row input{flex:1;min-width:180px}.nav{display:flex;gap:10px;margin-bottom:18px}.nav a{padding:9px 12px;border-radius:8px;color:#475467;text-decoration:none}.nav a.active{background:#e8edff;color:#304bb0;font-weight:700}.error{color:#b42318;background:#fff1f0;padding:10px;border-radius:8px;margin-bottom:14px}.muted{color:#667085}.stack{display:grid;gap:10px}@media(max-width:600px){.wrap{margin:20px auto}.bar{padding:13px 18px}}
  </style><header class="bar"><a class="brand" href="/">micro</a><div class="row">${u?`<span class="who">${esc(u.name)}</span><form method="post" action="/logout"><button class="danger">ログアウト</button></form>`:''}</div></header><main class="wrap">${content}</main></html>`;
}
function postCard(p) { return `<article class="card"><div class="body">${esc(p.body)}</div><div class="meta">${esc(p.display_name)} · ${esc(date(p.created_at))}${p.is_private?' · 🔒 非公開':''}</div></article>`; }
function errorBox(msg) { return msg ? `<div class="error">${esc(msg)}</div>` : ''; }
app.get('/login', async (req,res) => {
  try {
    const {metadata}=await getOidc();
    const state=randomBytes(24).toString('base64url'), nonce=randomBytes(24).toString('base64url');
    req.session.oidc={state,nonce,created:Date.now()};
    const u=new URL(metadata.authorization_endpoint); u.searchParams.set('response_type','code');u.searchParams.set('client_id',process.env.OIDC_CLIENT_ID);u.searchParams.set('redirect_uri',`${appUrl}/callback`);u.searchParams.set('scope','openid profile');u.searchParams.set('state',state);u.searchParams.set('nonce',nonce);
    res.redirect(u.toString());
  } catch(e) { res.status(503).send(page(req,'OIDC設定エラー',`<section class="card"><h1>ログインを開始できません</h1><p>${esc(e.message)}</p><p class="muted">READMEの手順でOIDC環境変数とプロバイダーのコールバックURLを設定してください。</p><a class="btn secondary" href="/">戻る</a></section>`)); }
});
app.get('/callback', async (req,res) => {
  try {
    const saved=req.session?.oidc; delete req.session.oidc;
    if(!saved || Date.now()-saved.created>10*60*1000 || req.query.state!==saved.state || !req.query.code) throw new Error('OIDC state/code validation failed');
    const {metadata,jwks}=await getOidc();
    const tokenRes=await fetch(metadata.token_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:String(req.query.code),redirect_uri:`${appUrl}/callback`,client_id:process.env.OIDC_CLIENT_ID,client_secret:process.env.OIDC_CLIENT_SECRET})});
    const tokens=await tokenRes.json(); if(!tokenRes.ok) throw new Error(tokens.error_description||tokens.error||'Token exchange failed');
    const {payload}=await jwtVerify(tokens.id_token,jwks,{issuer,audience:process.env.OIDC_CLIENT_ID,nonce:saved.nonce});
    if(typeof payload.sub!=='string'||!payload.sub) throw new Error('ID token has no sub claim');
    const name=String(payload.name||payload.preferred_username||payload.email||payload.sub).slice(0,120);
    db.prepare('INSERT INTO users(sub,display_name,created_at) VALUES(?,?,?) ON CONFLICT(sub) DO UPDATE SET display_name=excluded.display_name').run(payload.sub,name,new Date().toISOString());
    req.session.user={sub:payload.sub,name}; res.redirect('/');
  } catch(e) { res.status(401).send(page(req,'ログインエラー',`<section class="card"><h1>ログインできませんでした</h1><p>${esc(e.message)}</p><a class="btn" href="/login">再試行</a></section>`)); }
});
app.post('/logout',(req,res)=>{req.session=null;res.redirect('/');});
app.get('/',(req,res)=>{
  const u=current(req); const err=typeof req.query.error==='string'?req.query.error:'';
  if(!u) return res.send(page(req,'ようこそ',`<section class="card"><h1>小さなSNSへようこそ</h1><p>公開タイムライン、本人だけの非公開投稿、メンバー限定DMグループを利用できます。</p>${missing.length?`<div class="error">設定が必要です: ${esc(missing.join(', '))}</div>`:''}<a class="btn" href="/login">OIDCでログイン</a></section>`));
  const publicPosts=db.prepare(`SELECT posts.*,users.display_name FROM posts JOIN users ON users.sub=posts.author_sub WHERE is_private=0 ORDER BY id DESC LIMIT 100`).all();
  const privatePosts=db.prepare(`SELECT posts.*,users.display_name FROM posts JOIN users ON users.sub=posts.author_sub WHERE is_private=1 AND author_sub=? ORDER BY id DESC LIMIT 100`).all(u.sub);
  const groups=db.prepare(`SELECT groups.*, (SELECT COUNT(*) FROM group_members WHERE group_id=groups.id) AS member_count FROM groups JOIN group_members m ON m.group_id=groups.id WHERE m.user_sub=? ORDER BY groups.id DESC`).all(u.sub);
  const content=`<h1>こんにちは、${esc(u.name)}さん</h1><p class="meta">あなたのOIDC sub: <code>${esc(u.sub)}</code>（グループ招待用）</p>${errorBox(err)}<nav class="nav"><a class="active" href="/">タイムライン</a><a href="#private">非公開</a><a href="#groups">DMグループ</a></nav>
  <section class="card"><h2>投稿する</h2><form method="post" action="/posts"><textarea name="body" maxlength="2000" placeholder="いまどうしてる？" required></textarea><div class="row"><label><input style="width:auto;margin:0 5px 0 0" type="checkbox" name="private" value="1">自分だけに公開</label><button>投稿</button></div></form></section>
  <h2>公開タイムライン</h2>${publicPosts.length?publicPosts.map(postCard).join(''):'<section class="card muted">まだ投稿はありません。</section>'}
  <section id="private" class="card"><h2>自分の非公開投稿</h2>${privatePosts.length?privatePosts.map(postCard).join(''):'<p class="muted">非公開投稿はまだありません。</p>'}</section>
  <section id="groups" class="card"><h2>DMグループ</h2><form method="post" action="/groups"><label>新しいグループ名</label><input name="name" maxlength="80" required placeholder="例: プロジェクト相談"><button>グループを作成</button></form>${groups.length?`<div class="stack">${groups.map(g=>`<p><a href="/groups/${g.id}">${esc(g.name)}</a> <span class="meta">${g.member_count}人</span></p>`).join('')}</div>`:'<p class="muted">参加中のグループはありません。</p>'}</section>`;
  res.send(page(req,'タイムライン',content));
});
app.post('/posts',requireUser,(req,res)=>{const body=String(req.body.body||'').trim();if(!body||body.length>2000)return res.redirect('/?error='+encodeURIComponent('投稿は1〜2000文字で入力してください'));db.prepare('INSERT INTO posts(author_sub,body,is_private,created_at) VALUES(?,?,?,?)').run(current(req).sub,body,req.body.private==='1'?1:0,new Date().toISOString());res.redirect('/');});
app.post('/groups',requireUser,(req,res)=>{const name=String(req.body.name||'').trim();if(!name||name.length>80)return res.redirect('/?error='+encodeURIComponent('グループ名は1〜80文字で入力してください'));const u=current(req);const tx=db.transaction(()=>{const info=db.prepare('INSERT INTO groups(name,created_by,created_at) VALUES(?,?,?)').run(name,u.sub,new Date().toISOString());db.prepare('INSERT INTO group_members(group_id,user_sub) VALUES(?,?)').run(info.lastInsertRowid,u.sub);return info.lastInsertRowid;});res.redirect(`/groups/${tx()}`);});
function memberGroup(req,res,next){const g=db.prepare('SELECT groups.* FROM groups JOIN group_members m ON m.group_id=groups.id WHERE groups.id=? AND m.user_sub=?').get(Number(req.params.id),current(req).sub);if(!g)return res.status(404).send(page(req,'見つかりません',`<section class="card"><h1>グループが見つからないか、参加していません</h1><a href="/">ホームへ</a></section>`));req.group=g;next();}
app.get('/groups/:id',requireUser,memberGroup,(req,res)=>{const u=current(req);const members=db.prepare('SELECT users.sub,users.display_name FROM group_members JOIN users ON users.sub=group_members.user_sub WHERE group_id=? ORDER BY display_name').all(req.group.id);const messages=db.prepare('SELECT messages.*,users.display_name FROM messages JOIN users ON users.sub=messages.author_sub WHERE group_id=? ORDER BY id ASC LIMIT 300').all(req.group.id);const content=`<p><a href="/">← タイムライン</a></p>${errorBox(req.query.error)}<section class="card"><h1>${esc(req.group.name)}</h1><p class="meta">メンバー: ${members.map(m=>`${esc(m.display_name)} <code>${esc(m.sub)}</code>`).join('、')}</p><form method="post" action="/groups/${req.group.id}/members"><label>メンバーを追加（相手のOIDC sub）</label><input name="sub" placeholder="ユーザー識別子" required><button class="secondary">追加</button></form></section><section class="card"><h2>メッセージ</h2>${messages.length?messages.map(m=>`<article class="card"><div class="body">${esc(m.body)}</div><div class="meta">${esc(m.display_name)} · ${esc(date(m.created_at))}</div></article>`).join(''):'<p class="muted">メッセージはまだありません。</p>'}<form method="post" action="/groups/${req.group.id}/messages"><textarea name="body" maxlength="2000" required placeholder="グループにメッセージ"></textarea><button>送信</button></form></section>`;res.send(page(req,req.group.name,content));});
app.post('/groups/:id/members',requireUser,memberGroup,(req,res)=>{const sub=String(req.body.sub||'').trim();const user=db.prepare('SELECT sub FROM users WHERE sub=?').get(sub);if(!user)return res.redirect(`/groups/${req.group.id}?error=${encodeURIComponent('このユーザーはまだ一度もログインしていません')}`);try{db.prepare('INSERT INTO group_members(group_id,user_sub) VALUES(?,?)').run(req.group.id,sub);}catch{}res.redirect(`/groups/${req.group.id}`);});
app.post('/groups/:id/messages',requireUser,memberGroup,(req,res)=>{const body=String(req.body.body||'').trim();if(!body||body.length>2000)return res.redirect(`/groups/${req.group.id}?error=${encodeURIComponent('メッセージは1〜2000文字で入力してください')}`);db.prepare('INSERT INTO messages(group_id,author_sub,body,created_at) VALUES(?,?,?,?)').run(req.group.id,current(req).sub,body,new Date().toISOString());res.redirect(`/groups/${req.group.id}`);});
app.get('/health',(req,res)=>res.json({ok:true,oidcConfigured:missing.length===0}));
app.listen(port,'0.0.0.0',()=>console.log(`micro SNS listening on ${port}`));
