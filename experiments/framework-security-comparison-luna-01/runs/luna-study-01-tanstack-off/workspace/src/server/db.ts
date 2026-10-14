import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const path = resolve(process.env.DB_PATH || 'data/microsns.sqlite')
mkdirSync(dirname(path), { recursive: true })
export const db = new DatabaseSync(path)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
db.exec(`
CREATE TABLE IF NOT EXISTS users (sub TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, sub TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (group_id INTEGER NOT NULL, sub TEXT NOT NULL, PRIMARY KEY(group_id,sub), FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, sub TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE);
`)
export function transaction<T>(fn:()=>T):T { db.exec('BEGIN'); try { const value=fn(); db.exec('COMMIT'); return value } catch(e) { db.exec('ROLLBACK'); throw e } }
