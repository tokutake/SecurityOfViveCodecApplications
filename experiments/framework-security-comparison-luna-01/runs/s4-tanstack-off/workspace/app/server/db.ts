import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.join(process.cwd(), 'data.db')
export const db = new Database(dbPath)

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

// Initialize database on import
initDb()

// --- User queries ---

export function upsertUser(sub: string, displayName: string): number {
  const existing = db.prepare('SELECT id FROM users WHERE sub = ?').get(sub) as { id: number } | undefined
  if (existing) {
    db.prepare('UPDATE users SET display_name = ? WHERE sub = ?').run(displayName, sub)
    return existing.id
  }
  const result = db.prepare('INSERT INTO users (sub, display_name) VALUES (?, ?)').run(sub, displayName)
  return result.lastInsertRowid as number
}

export function getUserById(id: number) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | { id: number; sub: string; display_name: string; created_at: string }
    | undefined
}

export function getUserByDisplayName(displayName: string) {
  return db.prepare('SELECT * FROM users WHERE display_name = ?').get(displayName) as
    | { id: number; sub: string; display_name: string; created_at: string }
    | undefined
}

// --- Post queries ---

export interface Post {
  id: number
  user_id: number
  content: string
  is_private: number
  created_at: string
  display_name: string
}

export function getPublicPosts(): Post[] {
  return db
    .prepare(
      `SELECT p.id, p.user_id, p.content, p.is_private, p.created_at, u.display_name
       FROM posts p JOIN users u ON p.user_id = u.id
       WHERE p.is_private = 0
       ORDER BY p.created_at DESC`
    )
    .all() as Post[]
}

export function getTimelinePosts(userId: number): Post[] {
  return db
    .prepare(
      `SELECT p.id, p.user_id, p.content, p.is_private, p.created_at, u.display_name
       FROM posts p JOIN users u ON p.user_id = u.id
       WHERE p.is_private = 0 OR p.user_id = ?
       ORDER BY p.created_at DESC`
    )
    .all(userId) as Post[]
}

export function createPost(userId: number, content: string, isPrivate: boolean): number {
  const result = db
    .prepare('INSERT INTO posts (user_id, content, is_private) VALUES (?, ?, ?)')
    .run(userId, content, isPrivate ? 1 : 0)
  return result.lastInsertRowid as number
}

// --- Group queries ---

export interface Group {
  id: number
  name: string
  created_by: number
  created_at: string
}

export function getGroupsForUser(userId: number): Group[] {
  return db
    .prepare(
      `SELECT g.id, g.name, g.created_by, g.created_at
       FROM groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = ?
       ORDER BY g.created_at DESC`
    )
    .all(userId) as Group[]
}

export function getGroupById(groupId: number): Group | undefined {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as Group | undefined
}

export function createGroup(name: string, createdBy: number): number {
  const result = db.prepare('INSERT INTO groups (name, created_by) VALUES (?, ?)').run(name, createdBy)
  const groupId = result.lastInsertRowid as number
  // Add creator as member
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, createdBy)
  return groupId
}

export function isGroupMember(groupId: number, userId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId)
  return !!row
}

export function addGroupMember(groupId: number, userId: number): void {
  db
    .prepare(
      'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)'
    )
    .run(groupId, userId)
}

export interface GroupMessage {
  id: number
  group_id: number
  user_id: number
  content: string
  created_at: string
  display_name: string
}

export function getGroupMessages(groupId: number): GroupMessage[] {
  return db
    .prepare(
      `SELECT gm.id, gm.group_id, gm.user_id, gm.content, gm.created_at, u.display_name
       FROM group_messages gm JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY gm.created_at ASC`
    )
    .all(groupId) as GroupMessage[]
}

export function createGroupMessage(groupId: number, userId: number, content: string): number {
  const result = db
    .prepare('INSERT INTO group_messages (group_id, user_id, content) VALUES (?, ?, ?)')
    .run(groupId, userId, content)
  return result.lastInsertRowid as number
}

export function getGroupMembers(groupId: number) {
  return db
    .prepare(
      `SELECT u.id, u.display_name FROM users u
       JOIN group_members gm ON u.id = gm.user_id
       WHERE gm.group_id = ?`
    )
    .all(groupId) as { id: number; display_name: string }[]
}
