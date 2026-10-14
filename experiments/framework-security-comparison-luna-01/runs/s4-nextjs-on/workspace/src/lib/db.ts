import Database from "better-sqlite3"
import path from "path"

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data.db")

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined
}

function getDb(): Database.Database {
  if (!global.__db) {
    global.__db = new Database(DB_PATH)
    global.__db.pragma("journal_mode = WAL")
    global.__db.pragma("foreign_keys = ON")
    initSchema(global.__db)
  }
  return global.__db
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT    PRIMARY KEY,
      display_name TEXT   NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL REFERENCES users(id),
      content    TEXT    NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS dm_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      created_by TEXT    NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS dm_group_members (
      group_id INTEGER NOT NULL REFERENCES dm_groups(id) ON DELETE CASCADE,
      user_id  TEXT    NOT NULL REFERENCES users(id),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dm_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   INTEGER NOT NULL REFERENCES dm_groups(id) ON DELETE CASCADE,
      user_id    TEXT    NOT NULL REFERENCES users(id),
      content    TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_posts_created    ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_group   ON dm_messages(group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_members_user     ON dm_group_members(user_id);
  `)
}

// ---- User ----

export function upsertUser(id: string, displayName: string): void {
  getDb()
    .prepare(
      `INSERT INTO users (id, display_name) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name`
    )
    .run(id, displayName)
}

export function listUsers(): { id: string; display_name: string }[] {
  return getDb()
    .prepare("SELECT id, display_name FROM users ORDER BY display_name")
    .all() as { id: string; display_name: string }[]
}

// ---- Posts ----

export type Post = {
  id: number
  user_id: string
  display_name: string
  content: string
  is_private: number
  created_at: number
}

export function getTimeline(viewerId: string | null): Post[] {
  if (viewerId) {
    return getDb()
      .prepare(
        `SELECT p.id, p.user_id, u.display_name, p.content, p.is_private, p.created_at
         FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.is_private = 0 OR p.user_id = ?
         ORDER BY p.created_at DESC
         LIMIT 200`
      )
      .all(viewerId) as Post[]
  }
  return getDb()
    .prepare(
      `SELECT p.id, p.user_id, u.display_name, p.content, p.is_private, p.created_at
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.is_private = 0
       ORDER BY p.created_at DESC
       LIMIT 200`
    )
    .all() as Post[]
}

export function createPost(
  userId: string,
  content: string,
  isPrivate: boolean
): void {
  getDb()
    .prepare(
      "INSERT INTO posts (user_id, content, is_private) VALUES (?, ?, ?)"
    )
    .run(userId, content, isPrivate ? 1 : 0)
}

// ---- DM Groups ----

export type DmGroup = {
  id: number
  name: string
  created_by: string
  created_at: number
}

export function listGroupsForUser(userId: string): DmGroup[] {
  return getDb()
    .prepare(
      `SELECT g.id, g.name, g.created_by, g.created_at
       FROM dm_groups g
       JOIN dm_group_members m ON m.group_id = g.id
       WHERE m.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .all(userId) as DmGroup[]
}

export function getGroup(groupId: number): DmGroup | undefined {
  return getDb()
    .prepare("SELECT id, name, created_by, created_at FROM dm_groups WHERE id = ?")
    .get(groupId) as DmGroup | undefined
}

export function createGroup(
  name: string,
  creatorId: string,
  memberIds: string[]
): number {
  const db = getDb()
  const result = db
    .prepare("INSERT INTO dm_groups (name, created_by) VALUES (?, ?)")
    .run(name, creatorId)
  const groupId = result.lastInsertRowid as number

  // Always add creator
  const allMembers = Array.from(new Set([creatorId, ...memberIds]))
  const insertMember = db.prepare(
    "INSERT OR IGNORE INTO dm_group_members (group_id, user_id) VALUES (?, ?)"
  )
  for (const uid of allMembers) {
    insertMember.run(groupId, uid)
  }
  return groupId
}

export function isMember(groupId: number, userId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 FROM dm_group_members WHERE group_id = ? AND user_id = ?"
    )
    .get(groupId, userId)
  return row !== undefined
}

export function listMembers(
  groupId: number
): { id: string; display_name: string }[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.display_name
       FROM dm_group_members m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY u.display_name`
    )
    .all(groupId) as { id: string; display_name: string }[]
}

// ---- DM Messages ----

export type DmMessage = {
  id: number
  group_id: number
  user_id: string
  display_name: string
  content: string
  created_at: number
}

export function getMessages(groupId: number): DmMessage[] {
  return getDb()
    .prepare(
      `SELECT m.id, m.group_id, m.user_id, u.display_name, m.content, m.created_at
       FROM dm_messages m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY m.created_at ASC
       LIMIT 500`
    )
    .all(groupId) as DmMessage[]
}

export function createMessage(
  groupId: number,
  userId: string,
  content: string
): void {
  getDb()
    .prepare(
      "INSERT INTO dm_messages (group_id, user_id, content) VALUES (?, ?, ?)"
    )
    .run(groupId, userId, content)
}
