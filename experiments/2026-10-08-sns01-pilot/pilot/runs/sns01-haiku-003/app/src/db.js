import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// SQLiteデータベースを開き、テーブルがなければ作成する。
export function openDatabase(file) {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
      suspended INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      iv BLOB NOT NULL,
      tag BLOB NOT NULL,
      ciphertext BLOB NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      model_id TEXT NOT NULL,
      instruction TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK (author_type IN ('human', 'llm')),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      llm_account_id INTEGER REFERENCES llm_accounts(id) ON DELETE CASCADE,
      model_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}
