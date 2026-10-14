'use strict';

const express = require('express');
const { generators } = require('openid-client');
const db = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  const client = req.app.locals.oidcClient;
  const state = generators.state();
  const nonce = generators.nonce();

  req.session.oidcState = state;
  req.session.oidcNonce = nonce;

  const url = client.authorizationUrl({
    scope: 'openid profile email',
    state,
    nonce,
  });

  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  try {
    const client = req.app.locals.oidcClient;
    const params = client.callbackParams(req);

    const tokenSet = await client.callback(
      `${process.env.APP_URL}/callback`,
      params,
      {
        state: req.session.oidcState,
        nonce: req.session.oidcNonce,
      }
    );

    const claims = tokenSet.claims();
    const sub = claims.sub;
    const displayName =
      claims.name ||
      claims.preferred_username ||
      claims.email ||
      sub;

    const user = db.upsertUser(sub, displayName);

    delete req.session.oidcState;
    delete req.session.oidcNonce;

    req.session.userId = user.id;
    req.session.displayName = user.display_name;

    res.redirect('/');
  } catch (err) {
    console.error('OIDC callback error:', err);
    res.redirect('/?error=login_failed');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
