'use strict';

const express = require('express');
const db = require('../config/database');
const requireLogin = require('../middleware/requireLogin');

const router = express.Router();

router.get('/', (req, res) => {
  let posts;
  if (req.session.userId) {
    posts = db.prepare(`
      SELECT p.id, p.content, p.is_private, p.created_at, u.display_name
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.is_private = 0 OR p.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT 100
    `).all(req.session.userId);
  } else {
    posts = db.prepare(`
      SELECT p.id, p.content, p.is_private, p.created_at, u.display_name
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.is_private = 0
      ORDER BY p.created_at DESC
      LIMIT 100
    `).all();
  }

  res.render('timeline', { posts });
});

router.post('/post', requireLogin, (req, res) => {
  const content = (req.body.content || '').trim();
  const isPrivate = req.body.is_private === '1' ? 1 : 0;

  if (!content || content.length > 500) {
    req.session.flash = { type: 'error', message: '投稿は1〜500文字で入力してください。' };
    return res.redirect('/');
  }

  db.prepare('INSERT INTO posts (user_id, content, is_private) VALUES (?, ?, ?)')
    .run(req.session.userId, content, isPrivate);

  res.redirect('/');
});

module.exports = router;
