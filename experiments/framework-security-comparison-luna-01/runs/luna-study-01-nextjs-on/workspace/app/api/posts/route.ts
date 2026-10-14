import { NextRequest } from 'next/server'
import { guarded,body } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import db from '@/lib/db'
export const runtime='nodejs'
export async function GET(req:NextRequest){return guarded(req,async()=>{const u=await requireUser();return db.prepare('SELECT id,sub,name,body,private,created_at FROM posts WHERE private=0 OR sub=? ORDER BY created_at DESC,id DESC LIMIT 200').all(u.sub)})}
export async function POST(req:NextRequest){return guarded(req,async()=>{const u=await requireUser(),b=await body(req),text=typeof b.body==='string'?b.body.trim():'';if(!text||text.length>2000)throw Error('Post must be 1 to 2000 characters');const result=db.prepare('INSERT INTO posts(sub,name,body,private,created_at) VALUES(?,?,?,?,?)').run(u.sub,u.name,text,b.private===true||b.private==='true'?1:0,new Date().toISOString());return db.prepare('SELECT * FROM posts WHERE id=?').get(result.lastInsertRowid)},true)}
