import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const globalForDb = globalThis as unknown as { __db?: Database.Database };

function open(): Database.Database {
  const file = path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH || "./data/app.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      sub TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      sub TEXT NOT NULL REFERENCES users(sub),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_sub TEXT NOT NULL REFERENCES users(sub),
      body TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(sub),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      sub TEXT NOT NULL REFERENCES users(sub),
      PRIMARY KEY (group_id, sub)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      author_sub TEXT NOT NULL REFERENCES users(sub),
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_group ON messages(group_id, id);
  `);
  return db;
}

// import 時ではなく初回利用時に開く（ビルド時の並列ワーカーでの競合を避ける）
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_t, prop) {
    const real = (globalForDb.__db ??= open());
    const v = Reflect.get(real, prop, real);
    return typeof v === "function" ? v.bind(real) : v;
  },
});
