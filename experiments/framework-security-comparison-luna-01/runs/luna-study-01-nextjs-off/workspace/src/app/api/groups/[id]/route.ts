import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
type Context = { params: Promise<{id:string}> };
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const user = await requireUser(), { id } = await params, data = await request.json() as { sub?: string };
    const member = data.sub?.trim(); if (!member) return NextResponse.json({ error: 'ユーザーを選択してください' }, { status: 400 });
    const allowed = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND sub=?').get(id,user.sub);
    if (!allowed) return NextResponse.json({ error: 'グループにアクセスできません' }, { status: 403 });
    if (!db.prepare('SELECT 1 FROM users WHERE sub=?').get(member)) return NextResponse.json({ error: '追加するユーザーは一度ログインしている必要があります' }, { status: 400 });
    db.prepare('INSERT OR IGNORE INTO group_members(group_id,sub) VALUES(?,?)').run(id,member);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error && e.message === 'UNAUTHORIZED' ? 'ログインしてください' : 'メンバーを追加できませんでした' }, { status: e instanceof Error && e.message === 'UNAUTHORIZED' ? 401 : 500 }); }
}
