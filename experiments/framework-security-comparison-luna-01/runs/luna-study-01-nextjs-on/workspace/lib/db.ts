import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
const file = process.env.DATABASE_PATH || './data.sqlite'
const absoluteFile = path.resolve(/*turbopackIgnore: true*/ file)
fs.mkdirSync(path.dirname(absoluteFile), { recursive: true })
const db = new Database(absoluteFile)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, sub TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), private INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS posts_public_time ON posts(private,created_at DESC);
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, sub TEXT NOT NULL, name TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY(group_id,sub));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, sub TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_group_time ON messages(group_id,created_at,id);`)
export default db
