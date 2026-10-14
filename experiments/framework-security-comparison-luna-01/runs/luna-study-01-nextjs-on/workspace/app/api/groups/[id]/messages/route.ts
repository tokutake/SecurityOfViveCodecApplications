import { NextRequest } from 'next/server'
import { guarded,body } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import db from '@/lib/db'
import { assertMember } from '../members/route'
export const runtime='nodejs'
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){return guarded(req,async()=>{const u=await requireUser(),{id}=await params;assertMember(Number(id),u.sub);return db.prepare('SELECT id,sub,name,body,created_at FROM messages WHERE group_id=? ORDER BY created_at,id LIMIT 500').all(Number(id))})}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){return guarded(req,async()=>{const u=await requireUser(),{id}=await params,n=Number(id);assertMember(n,u.sub);const b=await body(req),text=typeof b.body==='string'?b.body.trim():'';if(!text||text.length>2000)throw Error('Message must be 1 to 2000 characters');const r=db.prepare('INSERT INTO messages(group_id,sub,name,body,created_at) VALUES(?,?,?,?,?)').run(n,u.sub,u.name,text,new Date().toISOString());return db.prepare('SELECT id,name,body,created_at FROM messages WHERE id=?').get(r.lastInsertRowid)},true)}
