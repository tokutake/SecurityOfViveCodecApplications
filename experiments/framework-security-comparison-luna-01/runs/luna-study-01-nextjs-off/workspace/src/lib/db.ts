import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.env.DATABASE_PATH || './data/microsns.sqlite');
fs.mkdirSync(path.dirname(file), { recursive: true });
const globalForDb = globalThis as unknown as { db?: Database.Database };
export const db = globalForDb.db ?? new Database(file);
if (process.env.NODE_ENV !== 'production') globalForDb.db = db;
db.pragma('busy_timeout = 10000');
// Next's build workers can load route modules concurrently. WAL mode is persistent;
// another worker may hold the schema lock while it is first enabled.
try { db.pragma('journal_mode = WAL'); } catch (error) { if (!(error instanceof Error && error.message.includes('locked'))) throw error; }
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (sub TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, sub TEXT NOT NULL REFERENCES users(sub), body TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owner_sub TEXT NOT NULL REFERENCES users(sub), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS group_members (group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, sub TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE, PRIMARY KEY(group_id, sub));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, sub TEXT NOT NULL REFERENCES users(sub), body TEXT NOT NULL, created_at TEXT NOT NULL);
`);
