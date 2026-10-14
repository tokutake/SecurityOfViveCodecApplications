import { NextRequest } from 'next/server'
import { guarded,body } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import db from '@/lib/db'
export const runtime='nodejs'
export async function GET(req:NextRequest){return guarded(req,async()=>{const u=await requireUser();return db.prepare('SELECT g.id,g.name,g.created_at FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.sub=? ORDER BY g.id DESC').all(u.sub)})}
export async function POST(req:NextRequest){return guarded(req,async()=>{const u=await requireUser(),b=await body(req),name=typeof b.name==='string'?b.name.trim():'';if(!name||name.length>80)throw Error('Group name must be 1 to 80 characters');const now=new Date().toISOString();const tx=db.transaction(()=>{const id=Number(db.prepare('INSERT INTO groups(name,created_by,created_at) VALUES(?,?,?)').run(name,u.sub,now).lastInsertRowid);db.prepare('INSERT INTO memberships(group_id,sub,name,added_at) VALUES(?,?,?,?)').run(id,u.sub,u.name,now);return{id,name,created_at:now}});return tx()},true)}
