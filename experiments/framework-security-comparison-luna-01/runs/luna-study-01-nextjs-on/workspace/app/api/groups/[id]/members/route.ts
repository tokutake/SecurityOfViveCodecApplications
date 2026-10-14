import { NextRequest } from 'next/server'
import { guarded,body } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import db from '@/lib/db'
export const runtime='nodejs'
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){return guarded(req,async()=>{const u=await requireUser(),{id}=await params;assertMember(Number(id),u.sub);return db.prepare('SELECT sub,name FROM memberships WHERE group_id=? ORDER BY name').all(Number(id))})}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){return guarded(req,async()=>{const u=await requireUser(),{id}=await params,n=Number(id),b=await body(req);assertMember(n,u.sub);if(!Number.isInteger(n)||typeof b.sub!=='string'||b.sub.length<1||b.sub.length>300||typeof b.name!=='string'||!b.name.trim()||b.name.length>100)throw Error('Valid member subject and display name required');db.prepare('INSERT OR IGNORE INTO memberships(group_id,sub,name,added_at) VALUES(?,?,?,?)').run(n,b.sub,b.name.trim(),new Date().toISOString());return{ok:true}},true)}
export function assertMember(id:number,sub:string){if(!Number.isInteger(id)||!db.prepare('SELECT 1 FROM memberships WHERE group_id=? AND sub=?').get(id,sub))throw Error('Group not found')}
