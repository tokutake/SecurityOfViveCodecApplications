import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUser, requireUser } from '@/lib/auth';
export async function GET() {
  const user = await getUser();
  const posts = user ? db.prepare(`SELECT posts.id,posts.body,posts.private,posts.created_at AS createdAt,users.name AS author FROM posts JOIN users ON users.sub=posts.sub WHERE posts.private=0 OR posts.sub=? ORDER BY posts.id DESC`).all(user.sub) : db.prepare(`SELECT posts.id,posts.body,posts.private,posts.created_at AS createdAt,users.name AS author FROM posts JOIN users ON users.sub=posts.sub WHERE posts.private=0 ORDER BY posts.id DESC`).all();
  return NextResponse.json({ posts });
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(), data = await request.json() as { body?: string; private?: boolean };
    const body = data.body?.trim(); if (!body || body.length > 1000) return NextResponse.json({ error: '投稿は1〜1000文字で入力してください' }, { status: 400 });
    const result = db.prepare('INSERT INTO posts(sub,body,private,created_at) VALUES(?,?,?,?)').run(user.sub, body, data.private ? 1 : 0, new Date().toISOString());
    return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error && e.message === 'UNAUTHORIZED' ? 'ログインしてください' : '投稿に失敗しました' }, { status: e instanceof Error && e.message === 'UNAUTHORIZED' ? 401 : 500 }); }
}
