'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { Issuer } = require('openid-client');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const required = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'APP_URL'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

// --- SQLite-backed session store ---

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sessionDb = new DatabaseSync(path.join(dataDir, 'sessions.db'));
sessionDb.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires INTEGER
  )
`);

class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = sessionDb.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires && Date.now() > Number(row.expires)) {
        sessionDb.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }

  set(sid, sessionData, cb) {
    try {
      const expires = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      sessionDb.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(sessionData), expires);
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    try {
      sessionDb.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }

  touch(sid, sessionData, cb) {
    this.set(sid, sessionData, cb);
  }
}

// --- Date formatter ---

function formatDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr);
  const d = new Date(s.includes('T') || s.includes('Z') ? s : s + 'Z');
  return d.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

// --- App bootstrap ---

async function main() {
  const issuer = await Issuer.discover(process.env.OIDC_ISSUER);
  const oidcClient = new issuer.Client({
    client_id: process.env.OIDC_CLIENT_ID,
    client_secret: process.env.OIDC_CLIENT_SECRET,
    redirect_uris: [`${process.env.APP_URL}/callback`],
    response_types: ['code'],
  });

  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.locals.oidcClient = oidcClient;
  app.locals.formatDate = formatDate;

  app.use(express.urlencoded({ extended: false }));

  app.use(session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));

  app.use(require('./routes/auth'));
  app.use(require('./routes/timeline'));
  app.use(require('./routes/dm'));

  app.use((req, res) => {
    res.status(404).render('error', {
      message: 'ページが見つかりません。',
      user: req.session.userId ? { id: req.session.userId, display_name: req.session.displayName } : null,
      activeNav: '',
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).render('error', {
      message: 'サーバーエラーが発生しました。',
      user: req.session.userId ? { id: req.session.userId, display_name: req.session.displayName } : null,
      activeNav: '',
    });
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => {
    console.log(`micro-sns running at http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
