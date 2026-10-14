'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const requiredEnvVars = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'APP_URL', 'SESSION_SECRET'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { Issuer } = require('openid-client');

const db = require('./config/database');
const SqliteSessionStore = require('./config/sessionStore');
const csrf = require('./middleware/csrf');
const authRouter = require('./routes/auth');
const timelineRouter = require('./routes/timeline');
const dmRouter = require('./routes/dm');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'app.db');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.use(session({
  store: new SqliteSessionStore(),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'sid',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.use(csrf);

app.use((req, res, next) => {
  res.locals.user = {
    userId: req.session.userId || null,
    displayName: req.session.displayName || null,
  };
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.use('/auth', authRouter);
app.use('/dm', dmRouter);
app.use('/', timelineRouter);

app.use((req, res) => {
  res.status(404).render('error', { message: 'ページが見つかりません。', statusCode: 404 });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.locals.user = res.locals.user || {};
  res.locals.csrfToken = res.locals.csrfToken || '';
  res.locals.flash = res.locals.flash || null;
  res.status(500).render('error', { message: 'サーバーエラーが発生しました。', statusCode: 500 });
});

async function main() {
  try {
    console.log('Initializing database...');
    await db.init(DB_PATH);

    console.log('Discovering OIDC issuer...');
    const issuer = await Issuer.discover(process.env.OIDC_ISSUER);
    const client = new issuer.Client({
      client_id: process.env.OIDC_CLIENT_ID,
      client_secret: process.env.OIDC_CLIENT_SECRET,
      redirect_uris: [`${process.env.APP_URL}/auth/callback`],
      response_types: ['code'],
    });

    authRouter.setClient(client);

    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

main();
