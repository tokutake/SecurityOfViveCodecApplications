import { createFileRoute } from '@tanstack/react-router'
import { currentUser,db } from '../server'
export const Route=createFileRoute('/api')({server:{handlers:{GET:async({request})=>handle(request),POST:async({request})=>handle(request)}}})
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}})
function handle(req:Request){try{
 const u=currentUser(req), action=new URL(req.url).searchParams.get('action'); if(!u)return json({error:'ログインしてください'},401)
 if(req.method==='POST'){const origin=req.headers.get('origin');if(origin&&origin!==process.env.APP_URL&&origin!==new URL(req.url).origin)return json({error:'不正なリクエストです'},403)}
 const bodyPromise=req.method==='POST'?req.json():Promise.resolve({}); return bodyPromise.then((data:any)=>{
 if(action==='init'){const posts=db.prepare(`SELECT posts.*,users.name FROM posts JOIN users ON users.sub=posts.sub WHERE posts.private=0 OR posts.sub=? ORDER BY posts.created DESC LIMIT 100`).all(u.sub);const groups=db.prepare(`SELECT groups.id,groups.name FROM groups JOIN members ON members.group_id=groups.id WHERE members.sub=? ORDER BY groups.created DESC`).all(u.sub);return json({user:u,posts,groups})}
 if(action==='post'){const text=clean(data.body);if(!text)return json({error:'本文を入力してください'},400);db.prepare('INSERT INTO posts(sub,body,private,created) VALUES(?,?,?,?)').run(u.sub,text,data.private?1:0,Date.now());return json({ok:true})}
 if(action==='createGroup'){const name=typeof data.name==='string'?data.name.trim():'';if(!name)return json({error:'グループ名を入力してください'},400);if(name.length>60)return json({error:'グループ名は60文字以内で入力してください'},400);const result=db.prepare('INSERT INTO groups(name,created) VALUES(?,?)').run(name,Date.now());db.prepare('INSERT INTO members VALUES(?,?)').run(result.lastInsertRowid,u.sub);return json({id:result.lastInsertRowid})}
 if(action==='addMember'){const id=Number(data.groupId),sub=clean(data.sub);if(!Number.isSafeInteger(id)||!sub)return json({error:'入力を確認してください'},400);if(!db.prepare('SELECT 1 FROM members WHERE group_id=? AND sub=?').get(id,u.sub))return json({error:'権限がありません'},403);if(!db.prepare('SELECT 1 FROM users WHERE sub=?').get(sub))return json({error:'先に一度ログインしたユーザーのsubを指定してください'},404);db.prepare('INSERT OR IGNORE INTO members VALUES(?,?)').run(id,sub);return json({ok:true})}
 if(action==='messages'||action==='message'){const id=Number(data.groupId);if(!Number.isSafeInteger(id)||!db.prepare('SELECT 1 FROM members WHERE group_id=? AND sub=?').get(id,u.sub))return json({error:'グループが見つからないか、権限がありません'},403);if(action==='messages'){const messages=db.prepare('SELECT messages.*,users.name FROM messages JOIN users ON users.sub=messages.sub WHERE group_id=? ORDER BY created ASC LIMIT 500').all(id);return json({messages})}const text=clean(data.body);if(!text)return json({error:'本文を入力してください'},400);db.prepare('INSERT INTO messages(group_id,sub,body,created) VALUES(?,?,?,?)').run(id,u.sub,text,Date.now());return json({ok:true})}
 return json({error:'Not found'},404)
 })
}catch(e){return json({error:'サーバーエラー'},500)}}
function clean(v:unknown){return typeof v==='string'?v.trim().slice(0,1000):''}
