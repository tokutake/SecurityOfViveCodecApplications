'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let sqldb = null;
let dbPath = null;
let _inTx = false;

function save() {
  if (_inTx) return;
  const data = sqldb.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function flatArgs(args) {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

function execMeta() {
  const stmt = sqldb.prepare('SELECT last_insert_rowid() AS rowid, changes() AS changes');
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return { lastInsertRowid: Number(row.rowid), changes: Number(row.changes) };
}

const db = {
  exec(sql) {
    sqldb.run(sql);
    save();
  },

  prepare(sql) {
    return {
      run(...args) {
        sqldb.run(sql, flatArgs(args));
        const meta = execMeta();
        save();
        return meta;
      },
      get(...args) {
        const params = flatArgs(args);
        const stmt = sqldb.prepare(sql);
        if (params.length) stmt.bind(params);
        let row;
        if (stmt.step()) row = stmt.getAsObject();
        stmt.free();
        return row;
      },
      all(...args) {
        const params = flatArgs(args);
        const stmt = sqldb.prepare(sql);
        if (params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
    };
  },

  transaction(fn) {
    return function (...args) {
      sqldb.run('BEGIN');
      _inTx = true;
      try {
        const result = fn(...args);
        sqldb.run('COMMIT');
        _inTx = false;
        save();
        return result;
      } catch (err) {
        try { sqldb.run('ROLLBACK'); } catch (_) {}
        _inTx = false;
        throw err;
      }
    };
  },
};

db.init = async function (filePath) {
  dbPath = filePath;
  const SQL = await initSqlJs();

  let buf = null;
  try { buf = fs.readFileSync(filePath); } catch (_) {}

  sqldb = new SQL.Database(buf);

  sqldb.run('PRAGMA foreign_keys = ON');
  sqldb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      sub  TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqldb.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqldb.run(`
    CREATE TABLE IF NOT EXISTS dm_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqldb.run(`
    CREATE TABLE IF NOT EXISTS dm_group_members (
      group_id INTEGER NOT NULL REFERENCES dm_groups(id) ON DELETE CASCADE,
      user_id  INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    )
  `);
  sqldb.run(`
    CREATE TABLE IF NOT EXISTS dm_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   INTEGER NOT NULL REFERENCES dm_groups(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqldb.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      sess    TEXT NOT NULL,
      expired INTEGER NOT NULL
    )
  `);

  save();
};

module.exports = db;
