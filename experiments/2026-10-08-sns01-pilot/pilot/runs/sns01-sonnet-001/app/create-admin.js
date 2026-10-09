// 使い方: ADMIN_PASSWORD='8文字以上' node create-admin.js <ユーザー名>
//   （ADMIN_PASSWORD 未指定時は対話入力。入力は画面に表示されます）
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

const username = process.argv[2];
if (!username || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
  console.error('ユーザー名(英数字と_の3〜20文字)を引数に指定してください');
  process.exit(1);
}
let password = process.env.ADMIN_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('パスワード(8文字以上): ');
  rl.close();
}
if (password.length < 8 || password.length > 200) {
  console.error('パスワードは8〜200文字にしてください');
  process.exit(1);
}
const db = openDb(process.env.SNS_DB || join(dirname(fileURLToPath(import.meta.url)), 'data', 'sns.db'));
if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
  console.error('このユーザー名は既に存在します');
  process.exit(1);
}
const salt = randomBytes(16);
db.prepare('INSERT INTO users (username, pass_salt, pass_hash, is_admin, created_at) VALUES (?,?,?,1,?)')
  .run(username, salt, scryptSync(password, salt, 64), Date.now());
console.log(`管理者 ${username} を作成しました`);
