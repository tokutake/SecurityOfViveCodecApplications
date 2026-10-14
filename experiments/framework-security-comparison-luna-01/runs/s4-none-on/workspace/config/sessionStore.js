'use strict';

const { Store } = require('express-session');
const db = require('./database');

const CLEANUP_INTERVAL = 15 * 60 * 1000;

class SqliteSessionStore extends Store {
  constructor() {
    super();
    setInterval(() => this._cleanup(), CLEANUP_INTERVAL).unref();
  }

  _cleanup() {
    try {
      db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
    } catch (_) {}
  }

  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) { cb(err); }
  }

  set(sid, session, cb) {
    try {
      const ttl = session.cookie?.maxAge ? session.cookie.maxAge : 86400000;
      const expired = Date.now() + ttl;
      const sess = JSON.stringify(session);
      const existing = db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(sid);
      if (existing) {
        db.prepare('UPDATE sessions SET sess = ?, expired = ? WHERE sid = ?').run(sess, expired, sid);
      } else {
        db.prepare('INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, sess, expired);
      }
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (err) { cb(err); }
  }

  touch(sid, session, cb) {
    try {
      const ttl = session.cookie?.maxAge ? session.cookie.maxAge : 86400000;
      const expired = Date.now() + ttl;
      db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(expired, sid);
      cb(null);
    } catch (err) { cb(err); }
  }
}

module.exports = SqliteSessionStore;
