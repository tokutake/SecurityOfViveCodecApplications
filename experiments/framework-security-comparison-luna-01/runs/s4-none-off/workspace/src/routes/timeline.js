'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

router.get('/', (req, res) => {
  const userId = req.session.userId || null;
  const posts = db.getTimelinePosts(userId);
  const error = req.query.error || null;

  res.render('timeline', {
    user: req.session.userId ? { id: req.session.userId, display_name: req.session.displayName } : null,
    posts,
    error,
    activeNav: 'timeline',
  });
});

router.post('/posts', requireAuth, (req, res) => {
  const content = (req.body.content || '').trim();
  const isPrivate = req.body.is_private === '1';

  if (!content) {
    return res.redirect('/?error=empty_post');
  }
  if (content.length > 500) {
    return res.redirect('/?error=too_long');
  }

  db.createPost(req.session.userId, content, isPrivate);
  res.redirect('/');
});

module.exports = router;
