import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
type Context = { params: Promise<{id:string}> };
export async function GET(_request: NextRequest, { params }: Context) {
  try { const user=await requireUser(),{id}=await params; if(!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND sub=?').get(id,user.sub)) return NextResponse.json({error:'グループにアクセスできません'},{status:403}); const messages=db.prepare(`SELECT messages.id,messages.body,messages.created_at AS createdAt,users.name AS author,messages.sub AS authorSub FROM messages JOIN users ON users.sub=messages.sub WHERE messages.group_id=? ORDER BY messages.id`).all(id); const members=db.prepare(`SELECT users.sub,users.name FROM group_members JOIN users ON users.sub=group_members.sub WHERE group_members.group_id=? ORDER BY users.name`).all(id); const users=db.prepare('SELECT sub,name FROM users ORDER BY name').all(); return NextResponse.json({messages,members,users}); }
  catch(e) { return NextResponse.json({error:e instanceof Error&&e.message==='UNAUTHORIZED'?'ログインしてください':'メッセージを取得できませんでした'},{status:e instanceof Error&&e.message==='UNAUTHORIZED'?401:500}); }
}
export async function POST(request: NextRequest,{params}:Context) {
  try { const user=await requireUser(),{id}=await params,data=await request.json() as {body?:string}; if(!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND sub=?').get(id,user.sub)) return NextResponse.json({error:'グループにアクセスできません'},{status:403}); const body=data.body?.trim(); if(!body||body.length>2000)return NextResponse.json({error:'メッセージは1〜2000文字で入力してください'},{status:400}); db.prepare('INSERT INTO messages(group_id,sub,body,created_at) VALUES(?,?,?,?)').run(id,user.sub,body,new Date().toISOString()); return NextResponse.json({ok:true},{status:201}); }
  catch(e) { return NextResponse.json({error:e instanceof Error&&e.message==='UNAUTHORIZED'?'ログインしてください':'メッセージを送信できませんでした'},{status:e instanceof Error&&e.message==='UNAUTHORIZED'?401:500}); }
}
