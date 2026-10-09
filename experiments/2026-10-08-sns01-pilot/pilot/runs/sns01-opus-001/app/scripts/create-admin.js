'use strict';
// 初期管理者の作成 / 既存ユーザーの管理者昇格
//   node scripts/create-admin.js <ユーザー名>
// パスワードは環境変数 ADMIN_PASSWORD か、未指定なら端末から入力する。
const readline = require('node:readline');
const { openDb } = require('../src/db');
const { hashPassword } = require('../src/security');

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (s) { if (s.startsWith(prompt)) rl.output.write(prompt); };
    rl.question(prompt, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

async function main() {
  const username = process.argv[2];
  if (!username || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    console.error('使い方: node scripts/create-admin.js <ユーザー名(英数字と_ 3〜20文字)>');
    process.exit(1);
  }
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await ask('パスワード: ');
    const again = await ask('パスワード(確認): ');
    if (password !== again) { console.error('パスワードが一致しません'); process.exit(1); }
  }
  if (password.length < 8) { console.error('パスワードは8文字以上にしてください'); process.exit(1); }

  const db = openDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', suspended = 0, password_hash = ? WHERE id = ?").run(hashPassword(password), existing.id);
    console.log(`既存ユーザー ${username} を管理者にしました (パスワード更新)`);
  } else {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hashPassword(password));
    console.log(`管理者 ${username} を作成しました`);
  }
  db.close();
}

main();
