import "server-only";
import { db } from "./db";

export const MAX_BODY = 2000;
export const MAX_GROUP_NAME = 100;

export type Entry = {
  id: number;
  body: string;
  createdAt: number;
  authorName: string;
  authorSub: string;
  isPrivate?: boolean;
};

/** 公開投稿 + 閲覧者自身の非公開投稿のみ。他人の非公開投稿は返さない */
export function listTimeline(viewerSub: string): Entry[] {
  return db
    .prepare(
      `SELECT p.id, p.body, p.created_at AS createdAt, p.is_private AS isPrivate,
              p.author_sub AS authorSub, u.display_name AS authorName
       FROM posts p JOIN users u ON u.sub = p.author_sub
       WHERE p.is_private = 0 OR p.author_sub = ?
       ORDER BY p.created_at DESC, p.id DESC LIMIT 200`,
    )
    .all(viewerSub)
    .map((r: any) => ({ ...r, isPrivate: !!r.isPrivate }));
}

export function createPost(sub: string, body: string, isPrivate: boolean) {
  db.prepare(
    "INSERT INTO posts (author_sub, body, is_private, created_at) VALUES (?, ?, ?, ?)",
  ).run(sub, body, isPrivate ? 1 : 0, Date.now());
}

export function isMember(groupId: number, sub: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND sub = ?")
    .get(groupId, sub);
}

export function listGroups(sub: string) {
  return db
    .prepare(
      `SELECT g.id, g.name FROM groups g
       JOIN group_members m ON m.group_id = g.id
       WHERE m.sub = ? ORDER BY g.id DESC`,
    )
    .all(sub) as { id: number; name: string }[];
}

export function listOtherUsers(sub: string) {
  return db
    .prepare(
      "SELECT sub, display_name AS displayName FROM users WHERE sub != ? ORDER BY display_name",
    )
    .all(sub) as { sub: string; displayName: string }[];
}

export function createGroup(creator: string, name: string, memberSubs: string[]): number {
  return db.transaction(() => {
    const id = Number(
      db
        .prepare("INSERT INTO groups (name, created_by, created_at) VALUES (?, ?, ?)")
        .run(name, creator, Date.now()).lastInsertRowid,
    );
    const add = db.prepare("INSERT OR IGNORE INTO group_members (group_id, sub) VALUES (?, ?)");
    const exists = db.prepare("SELECT 1 FROM users WHERE sub = ?");
    add.run(id, creator);
    for (const s of memberSubs) if (exists.get(s)) add.run(id, s);
    return id;
  })();
}

/** メンバーでなければ null（存在有無も区別しない） */
export function getGroupForMember(groupId: number, sub: string) {
  if (!isMember(groupId, sub)) return null;
  const group = db
    .prepare("SELECT id, name FROM groups WHERE id = ?")
    .get(groupId) as { id: number; name: string };
  const members = db
    .prepare(
      `SELECT u.display_name AS displayName FROM group_members m
       JOIN users u ON u.sub = m.sub WHERE m.group_id = ? ORDER BY u.display_name`,
    )
    .all(groupId) as { displayName: string }[];
  const messages = db
    .prepare(
      `SELECT x.id, x.body, x.created_at AS createdAt, x.author_sub AS authorSub,
              u.display_name AS authorName
       FROM messages x JOIN users u ON u.sub = x.author_sub
       WHERE x.group_id = ? ORDER BY x.id DESC LIMIT 500`,
    )
    .all(groupId) as Entry[];
  return { ...group, members: members.map((m) => m.displayName), messages: messages.reverse() };
}

/** メンバーでなければ false を返し、書き込まない */
export function addMessage(groupId: number, sub: string, body: string): boolean {
  if (!isMember(groupId, sub)) return false;
  db.prepare(
    "INSERT INTO messages (group_id, author_sub, body, created_at) VALUES (?, ?, ?, ?)",
  ).run(groupId, sub, body, Date.now());
  return true;
}
