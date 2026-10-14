'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

router.get('/dm', requireAuth, (req, res) => {
  const groups = db.getUserGroups(req.session.userId);
  res.render('dm-list', {
    user: { id: req.session.userId, display_name: req.session.displayName },
    groups,
    activeNav: 'dm',
  });
});

router.post('/dm', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.redirect('/dm?error=empty_name');
  }
  if (name.length > 100) {
    return res.redirect('/dm?error=too_long');
  }
  const group = db.createGroup(name, req.session.userId);
  res.redirect(`/dm/${group.id}`);
});

router.get('/dm/:id', requireAuth, (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(404).render('error', { message: 'グループが見つかりません。', user: null, activeNav: 'dm' });

  const group = db.getGroup(groupId);
  if (!group) return res.status(404).render('error', { message: 'グループが見つかりません。', user: null, activeNav: 'dm' });

  if (!db.isGroupMember(groupId, req.session.userId)) {
    return res.status(403).render('error', { message: 'このグループのメンバーではありません。', user: { id: req.session.userId, display_name: req.session.displayName }, activeNav: 'dm' });
  }

  const messages = db.getGroupMessages(groupId);
  const members = db.getGroupMembers(groupId);
  const nonMembers = db.getNonMembers(groupId);
  const error = req.query.error || null;

  res.render('dm-group', {
    user: { id: req.session.userId, display_name: req.session.displayName },
    group,
    messages,
    members,
    nonMembers,
    error,
    activeNav: 'dm',
  });
});

router.post('/dm/:id/messages', requireAuth, (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(404).render('error', { message: 'グループが見つかりません。', user: null, activeNav: 'dm' });

  if (!db.isGroupMember(groupId, req.session.userId)) {
    return res.status(403).render('error', { message: 'このグループのメンバーではありません。', user: { id: req.session.userId, display_name: req.session.displayName }, activeNav: 'dm' });
  }

  const content = (req.body.content || '').trim();
  if (!content) return res.redirect(`/dm/${groupId}?error=empty_message`);
  if (content.length > 1000) return res.redirect(`/dm/${groupId}?error=too_long`);

  db.createGroupMessage(groupId, req.session.userId, content);
  res.redirect(`/dm/${groupId}`);
});

router.post('/dm/:id/members', requireAuth, (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId)) return res.status(404).render('error', { message: 'グループが見つかりません。', user: null, activeNav: 'dm' });

  if (!db.isGroupMember(groupId, req.session.userId)) {
    return res.status(403).render('error', { message: 'このグループのメンバーではありません。', user: { id: req.session.userId, display_name: req.session.displayName }, activeNav: 'dm' });
  }

  const targetUserId = parseInt(req.body.user_id, 10);
  if (!Number.isInteger(targetUserId)) return res.redirect(`/dm/${groupId}?error=invalid_user`);

  const targetUser = db.getUserById(targetUserId);
  if (!targetUser) return res.redirect(`/dm/${groupId}?error=invalid_user`);

  db.addGroupMember(groupId, targetUserId);
  res.redirect(`/dm/${groupId}`);
});

module.exports = router;
