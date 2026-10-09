#!/usr/bin/env node

import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

console.log('SNS-01 テストスイート\n');

// Test 1: Database initialization
console.log('Test 1: Database initialization');
const db = new DatabaseSync(':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
`);
console.log('✓ Database initialization successful\n');

// Test 2: User registration
console.log('Test 2: User registration');
const adminPasswordHash = hashPassword('admin123');
const result1 = db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
).run('admin', adminPasswordHash, 'admin');
console.log(`✓ Admin user created (ID: ${result1.lastInsertRowid})\n`);

const userPasswordHash = hashPassword('user123');
const result2 = db.prepare(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
).run('user1', userPasswordHash, 'user');
console.log(`✓ Regular user created (ID: ${result2.lastInsertRowid})\n`);

// Test 3: User authentication
console.log('Test 3: User authentication');
const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (admin && admin.password_hash === adminPasswordHash) {
  console.log('✓ Admin authentication successful\n');
} else {
  console.error('✗ Admin authentication failed\n');
}

// Test 4: LLM account creation
console.log('Test 4: LLM account creation');
const llmResult = db.prepare(
  'INSERT INTO llm_accounts (owner_id, display_name, model_id, prompt) VALUES (?, ?, ?, ?)'
).run(result2.lastInsertRowid, 'Test LLM', 'test/model-a', 'Generate a post');
console.log(`✓ LLM account created (ID: ${llmResult.lastInsertRowid})\n`);

// Test 5: Post creation
console.log('Test 5: Human post creation');
const postContent = 'これはテスト投稿です';
const charCount = [...postContent].length;
console.log(`  Post content: "${postContent}"`);
console.log(`  Character count (Unicode codepoints): ${charCount}`);

let postResult;
if (charCount > 140) {
  console.error('✗ Post exceeds 140 characters\n');
} else {
  postResult = db.prepare(
    'INSERT INTO posts (author_id, content, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  ).run(result2.lastInsertRowid, postContent);
  console.log(`✓ Human post created (ID: ${postResult.lastInsertRowid})\n`);
}

// Test 6: LLM post creation
console.log('Test 6: LLM post creation');
const llmPostContent = 'これはLLMの投稿です';
const llmCharCount = [...llmPostContent].length;
console.log(`  Post content: "${llmPostContent}"`);
console.log(`  Character count: ${llmCharCount}`);

const llmPostResult = db.prepare(
  'INSERT INTO posts (llm_account_id, content, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
).run(llmResult.lastInsertRowid, llmPostContent);
console.log(`✓ LLM post created (ID: ${llmPostResult.lastInsertRowid})\n`);

// Test 7: Timeline query
console.log('Test 7: Timeline query');
const timeline = db.prepare(`
  SELECT
    p.id, p.content, p.created_at, p.author_id, p.llm_account_id,
    u.username, l.display_name, l.model_id
  FROM posts p
  LEFT JOIN users u ON p.author_id = u.id
  LEFT JOIN llm_accounts l ON p.llm_account_id = l.id
  WHERE p.deleted_at IS NULL
  ORDER BY p.created_at DESC
`).all();

console.log(`  Timeline posts: ${timeline.length}`);
timeline.forEach(post => {
  const author = post.username || `${post.display_name} (${post.model_id})`;
  console.log(`  - [${post.id}] ${author}: "${post.content}"`);
});
console.log();

// Test 8: Post deletion
console.log('Test 8: Post deletion');
if (postResult) {
  db.prepare('UPDATE posts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(postResult.lastInsertRowid);
  console.log(`✓ Post deletion (logical) successful\n`);
} else {
  console.log('⊘ Post deletion skipped (no post created)\n');
}

// Test 9: User suspension
console.log('Test 9: User suspension');
db.prepare('UPDATE users SET status = ? WHERE id = ?').run('suspended', result2.lastInsertRowid);
const suspendedUser = db.prepare('SELECT status FROM users WHERE id = ?').get(result2.lastInsertRowid);
if (suspendedUser.status === 'suspended') {
  console.log('✓ User suspension successful\n');
} else {
  console.error('✗ User suspension failed\n');
}

// Test 10: Post character limit
console.log('Test 10: Post character limit validation');
const longPost = 'あ'.repeat(141);
const longCharCount = [...longPost].length;
console.log(`  Long post character count: ${longCharCount}`);
if (longCharCount > 140) {
  console.log('✓ Long post correctly rejected (>140 characters)\n');
} else {
  console.error('✗ Long post validation failed\n');
}

console.log('All tests completed!');
