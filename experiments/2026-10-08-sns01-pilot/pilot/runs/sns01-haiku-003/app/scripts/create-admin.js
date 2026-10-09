// 初期管理者を作成する。使い方: npm run create-admin -- <ユーザー名>
// パスワードは対話入力する。非対話で実行する場合は環境変数 SNS_ADMIN_PASSWORD を指定する。
import path from 'node:path';
import readline from 'node:readline/promises';
import { hashPassword } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { parsePassword, parseUsername } from '../src/validation.js';

async function main() {
  const config = loadConfig();
  const username = parseUsername(process.argv[2] ?? '');
  const db = openDatabase(path.join(config.dataDir, 'sns.db'));

  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    throw new Error(`ユーザー名 ${username} は既に存在します`);
  }

  let password = process.env.SNS_ADMIN_PASSWORD;
  if (password === undefined) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      password = await rl.question('管理者パスワード（8文字以上）: ');
      const confirm = await rl.question('確認のためもう一度入力: ');
      if (password !== confirm) throw new Error('パスワードが一致しません');
    } finally {
      rl.close();
    }
  }
  parsePassword(password);

  db.prepare('INSERT INTO users (username, password_hash, role, suspended, created_at) VALUES (?, ?, ?, 0, ?)').run(
    username,
    await hashPassword(password),
    'admin',
    new Date().toISOString(),
  );
  db.close();
  console.log(`管理者 ${username} を作成しました`);
}

main().catch((err) => {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
});
