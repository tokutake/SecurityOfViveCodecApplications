import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
export async function GET() {
  try { const user = await requireUser(); const groups = db.prepare(`SELECT g.id,g.name,g.created_at AS createdAt,(SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id) AS memberCount FROM groups g JOIN group_members mine ON mine.group_id=g.id WHERE mine.sub=? ORDER BY g.id DESC`).all(user.sub); const users = db.prepare('SELECT sub,name FROM users WHERE sub<>? ORDER BY name').all(user.sub); return NextResponse.json({ groups, users }); }
  catch { return NextResponse.json({ error: 'ログインしてください' }, { status: 401 }); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(), data = await request.json() as { name?: string; members?: string[] };
    const name = data.name?.trim(); if (!name || name.length > 80) return NextResponse.json({ error: 'グループ名は1〜80文字で入力してください' }, { status: 400 });
    const members = [...new Set([user.sub, ...(data.members || [])])];
    const known = db.prepare(`SELECT sub FROM users WHERE sub IN (${members.map(() => '?').join(',')})`).all(...members) as {sub:string}[];
    if (known.length !== members.length) return NextResponse.json({ error: '追加するメンバーは一度ログインしている必要があります' }, { status: 400 });
    const create = db.transaction(() => { const g = db.prepare('INSERT INTO groups(name,owner_sub,created_at) VALUES(?,?,?)').run(name,user.sub,new Date().toISOString()); const add = db.prepare('INSERT INTO group_members(group_id,sub) VALUES(?,?)'); members.forEach(sub=>add.run(g.lastInsertRowid,sub)); return g.lastInsertRowid; });
    return NextResponse.json({ id: create() }, { status: 201 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error && e.message === 'UNAUTHORIZED' ? 'ログインしてください' : 'グループを作成できませんでした' }, { status: e instanceof Error && e.message === 'UNAUTHORIZED' ? 401 : 500 }); }
}
