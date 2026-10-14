'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(path.join(dataDir, 'micro-sns.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS dm_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS dm_group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES dm_groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES dm_groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

function upsertUser(sub, displayName) {
  db.prepare('INSERT OR IGNORE INTO users (sub, display_name) VALUES (?, ?)').run(sub, displayName);
  db.prepare('UPDATE users SET display_name = ? WHERE sub = ?').run(displayName, sub);
  return db.prepare('SELECT * FROM users WHERE sub = ?').get(sub);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getTimelinePosts(userId) {
  if (userId) {
    return db.prepare(`
      SELECT p.*, u.display_name FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.is_private = 0 OR p.user_id = ?
      ORDER BY p.created_at DESC
    `).all(userId);
  }
  return db.prepare(`
    SELECT p.*, u.display_name FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.is_private = 0
    ORDER BY p.created_at DESC
  `).all();
}

function createPost(userId, content, isPrivate) {
  const result = db.prepare(
    'INSERT INTO posts (user_id, content, is_private) VALUES (?, ?, ?)'
  ).run(userId, content, isPrivate ? 1 : 0);
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
}

function getUserGroups(userId) {
  return db.prepare(`
    SELECT g.*, u.display_name AS creator_name,
      (SELECT COUNT(*) FROM dm_group_members WHERE group_id = g.id) AS member_count
    FROM dm_groups g
    JOIN users u ON g.created_by = u.id
    JOIN dm_group_members m ON g.id = m.group_id
    WHERE m.user_id = ?
    ORDER BY g.created_at DESC
  `).all(userId);
}

function getGroup(groupId) {
  return db.prepare(`
    SELECT g.*, u.display_name AS creator_name
    FROM dm_groups g
    JOIN users u ON g.created_by = u.id
    WHERE g.id = ?
  `).get(groupId);
}

function isGroupMember(groupId, userId) {
  return !!db.prepare(
    'SELECT 1 FROM dm_group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, userId);
}

function createGroup(name, createdBy) {
  const result = db.prepare(
    'INSERT INTO dm_groups (name, created_by) VALUES (?, ?)'
  ).run(name, createdBy);
  const groupId = result.lastInsertRowid;
  db.prepare('INSERT INTO dm_group_members (group_id, user_id) VALUES (?, ?)').run(groupId, createdBy);
  return db.prepare('SELECT * FROM dm_groups WHERE id = ?').get(groupId);
}

function addGroupMember(groupId, userId) {
  db.prepare('INSERT OR IGNORE INTO dm_group_members (group_id, user_id) VALUES (?, ?)').run(groupId, userId);
}

function getGroupMessages(groupId) {
  return db.prepare(`
    SELECT m.*, u.display_name FROM dm_messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.group_id = ?
    ORDER BY m.created_at ASC
  `).all(groupId);
}

function createGroupMessage(groupId, userId, content) {
  const result = db.prepare(
    'INSERT INTO dm_messages (group_id, user_id, content) VALUES (?, ?, ?)'
  ).run(groupId, userId, content);
  return db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(result.lastInsertRowid);
}

function getGroupMembers(groupId) {
  return db.prepare(`
    SELECT u.* FROM users u
    JOIN dm_group_members m ON u.id = m.user_id
    WHERE m.group_id = ?
    ORDER BY m.joined_at ASC
  `).all(groupId);
}

function getNonMembers(groupId) {
  return db.prepare(`
    SELECT * FROM users
    WHERE id NOT IN (SELECT user_id FROM dm_group_members WHERE group_id = ?)
    ORDER BY display_name ASC
  `).all(groupId);
}

module.exports = {
  upsertUser,
  getUserById,
  getTimelinePosts,
  createPost,
  getUserGroups,
  getGroup,
  isGroupMember,
  createGroup,
  addGroupMember,
  getGroupMessages,
  createGroupMessage,
  getGroupMembers,
  getNonMembers,
};
