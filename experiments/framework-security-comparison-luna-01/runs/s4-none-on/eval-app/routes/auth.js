'use strict';

const express = require('express');
const { generators } = require('openid-client');
const db = require('../config/database');

const router = express.Router();
let oidcClient = null;

router.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  if (!oidcClient) {
    return res.status(503).render('error', { message: 'サービスの準備中です。しばらく待ってから再試行してください。', statusCode: 503 });
  }

  const state = generators.state();
  const nonce = generators.nonce();
  req.session.oidcState = state;
  req.session.oidcNonce = nonce;

  const url = oidcClient.authorizationUrl({
    scope: 'openid profile email',
    state,
    nonce,
  });

  res.redirect(url);
});

router.get('/callback', async (req, res, next) => {
  if (!oidcClient) {
    return res.status(503).render('error', { message: 'サービスの準備中です。', statusCode: 503 });
  }
  if (!req.session.oidcState) {
    return res.status(400).render('error', { message: '認証セッションが見つかりません。ログインからやり直してください。', statusCode: 400 });
  }

  try {
    const params = oidcClient.callbackParams(req);
    const tokenSet = await oidcClient.callback(
      `${process.env.APP_URL}/auth/callback`,
      params,
      {
        state: req.session.oidcState,
        nonce: req.session.oidcNonce,
      }
    );

    const claims = tokenSet.claims();
    const sub = claims.sub;
    const displayName = String(
      claims.name || claims.preferred_username || claims.email || sub
    ).slice(0, 100);

    db.prepare(`
      INSERT INTO users (sub, display_name) VALUES (?, ?)
      ON CONFLICT(sub) DO UPDATE SET display_name = excluded.display_name
    `).run(sub, displayName);

    const user = db.prepare('SELECT id FROM users WHERE sub = ?').get(sub);
    const returnTo = req.session.returnTo || '/';
    const safeReturnTo = /^\/(?!\/)/.test(returnTo) ? returnTo : '/';

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.displayName = displayName;
      res.redirect(safeReturnTo);
    });
  } catch (err) {
    console.error('OIDC callback error:', err.message);
    res.status(400).render('error', {
      message: '認証に失敗しました。再度ログインしてください。',
      statusCode: 400,
    });
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/');
  });
});

router.setClient = (client) => {
  oidcClient = client;
};

module.exports = router;
