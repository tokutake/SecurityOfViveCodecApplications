import { createServerFn } from '@tanstack/react-start'
import { currentUser } from './auth'
import { db, transaction } from './db'

const requireUser = async () => { const u = await currentUser(); if (!u) throw new Error('ログインしてください'); return u }
const str = (x:unknown, max=2000) => { if (typeof x !== 'string' || !x.trim() || x.length > max) throw new Error('入力内容を確認してください'); return x.trim() }
export const getData = createServerFn({ method:'GET' }).handler(async () => {
  const user = await currentUser()
  const posts = db.prepare(`SELECT id,sub,name,body,private,created_at FROM posts WHERE private=0 ${user ? 'OR (private=1 AND sub=?)' : ''} ORDER BY id DESC LIMIT 100`).all(...(user ? [user.sub] : []))
  const groups = user ? db.prepare('SELECT g.id,g.name FROM groups g JOIN members m ON m.group_id=g.id WHERE m.sub=? ORDER BY g.id DESC').all(user.sub) : []
  const users = user ? db.prepare('SELECT sub,name FROM users WHERE sub<>? ORDER BY name').all(user.sub) : []
  return { user, posts, groups, users }
})
export const createPost = createServerFn({ method:'POST' }).validator((v:{body:string; private:boolean}) => v).handler(async ({data}) => { const u=await requireUser(); const body=str(data.body,2000); db.prepare('INSERT INTO posts(sub,name,body,private) VALUES(?,?,?,?)').run(u.sub,u.name,body,data.private?1:0); return true })
export const createGroup = createServerFn({ method:'POST' }).validator((v:{name:string; members:string[]}) => v).handler(async ({data}) => { const u=await requireUser(), name=str(data.name,80); const ids=[...new Set([u.sub,...data.members.map(x=>str(x,500))])]; const run=transaction(()=>{ const result=db.prepare('INSERT INTO groups(name,created_by) VALUES(?,?)').run(name,u.sub); const add=db.prepare('INSERT OR IGNORE INTO members(group_id,sub) VALUES(?,?)'); ids.forEach(id=>add.run(result.lastInsertRowid,id)); return result.lastInsertRowid }); return run })
export const addMember = createServerFn({ method:'POST' }).validator((v:{groupId:number; sub:string})=>v).handler(async ({data}) => { const u=await requireUser(); const member=db.prepare('SELECT 1 FROM members WHERE group_id=? AND sub=?').get(data.groupId,u.sub); if(!member) throw new Error('グループメンバーのみ操作できます'); if(!db.prepare('SELECT 1 FROM users WHERE sub=?').get(data.sub)) throw new Error('ユーザーが見つかりません'); db.prepare('INSERT OR IGNORE INTO members(group_id,sub) VALUES(?,?)').run(data.groupId,data.sub); return true })
export const getMessages = createServerFn({ method:'POST' }).validator((v:{groupId:number})=>v).handler(async ({data}) => { const u=await requireUser(); if(!db.prepare('SELECT 1 FROM members WHERE group_id=? AND sub=?').get(data.groupId,u.sub)) throw new Error('このグループを閲覧できません'); return db.prepare('SELECT id,sub,name,body,created_at FROM messages WHERE group_id=? ORDER BY id').all(data.groupId) })
export const sendMessage = createServerFn({ method:'POST' }).validator((v:{groupId:number; body:string})=>v).handler(async ({data}) => { const u=await requireUser(); if(!db.prepare('SELECT 1 FROM members WHERE group_id=? AND sub=?').get(data.groupId,u.sub)) throw new Error('このグループに投稿できません'); db.prepare('INSERT INTO messages(group_id,sub,name,body) VALUES(?,?,?,?)').run(data.groupId,u.sub,u.name,str(data.body)); return true })
export const logoutAction = createServerFn({method:'POST'}).handler(async()=>{ const { logout }=await import('./auth'); logout(); return true })
