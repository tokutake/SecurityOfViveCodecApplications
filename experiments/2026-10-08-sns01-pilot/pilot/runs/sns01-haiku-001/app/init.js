#!/usr/bin/env node

import crypto from 'crypto';
import readline from 'readline';
import { DatabaseSync } from 'node:sqlite';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function question(rl, prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('SNS-01 初期管理者作成');
  console.log('====================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const username = await question(rl, '管理者ユーザー名: ');
  const password = await question(rl, '管理者パスワード: ');

  if (!username || !password) {
    console.error('ユーザー名とパスワードは必須です');
    rl.close();
    process.exit(1);
  }

  try {
    const db = new DatabaseSync('data.db');

    // Initialize database
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_keys (
        user_id INTEGER PRIMARY KEY,
        openrouter_key TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS llm_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        display_name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER,
        llm_account_id INTEGER,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME,
        FOREIGN KEY (author_id) REFERENCES users(id),
        FOREIGN KEY (llm_account_id) REFERENCES llm_accounts(id)
      );

      CREATE TABLE IF NOT EXISTS api_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_identifier TEXT NOT NULL,
        model_id TEXT NOT NULL,
        call_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const passwordHash = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, status)
      VALUES (?, ?, ?, ?)
    `).run(username, passwordHash, 'admin', 'active');

    console.log(`\n管理者ユーザーを作成しました: ${username}`);
    console.log(`ID: ${result.lastInsertRowid}`);

    rl.close();
    process.exit(0);
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      console.error('このユーザー名は既に存在します');
    } else {
      console.error('エラー:', error.message);
    }
    rl.close();
    process.exit(1);
  }
}

main();
