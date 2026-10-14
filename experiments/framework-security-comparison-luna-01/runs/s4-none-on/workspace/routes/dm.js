'use strict';

const express = require('express');
const db = require('../config/database');
const requireLogin = require('../middleware/requireLogin');

const router = express.Router();

router.use(requireLogin);

router.get('/', (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.created_at, u.display_name AS creator_name
    FROM dm_groups g
    JOIN dm_group_members m ON g.id = m.group_id
    JOIN users u ON g.created_by = u.id
    WHERE m.user_id = ?
    ORDER BY g.created_at DESC
  `).all(req.session.userId);

  res.render('dm/index', { groups });
});

router.get('/new', (req, res) => {
  const users = db.prepare(
    'SELECT id, display_name FROM users WHERE id != ? ORDER BY display_name'
  ).all(req.session.userId);

  res.render('dm/new', { users });
});

router.post('/new', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name || name.length > 100) {
    req.session.flash = { type: 'error', message: 'グループ名は1〜100文字で入力してください。' };
    return res.redirect('/dm/new');
  }

  const rawMembers = req.body.members;
  const memberIds = (Array.isArray(rawMembers) ? rawMembers : rawMembers ? [rawMembers] : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0 && id !== req.session.userId);

  const createGroup = db.transaction(() => {
    const { lastInsertRowid: groupId } = db.prepare(
      'INSERT INTO dm_groups (name, created_by) VALUES (?, ?)'
    ).run(name, req.session.userId);

    db.prepare('INSERT INTO dm_group_members (group_id, user_id) VALUES (?, ?)')
      .run(groupId, req.session.userId);

    const insertMember = db.prepare(
      'INSERT OR IGNORE INTO dm_group_members (group_id, user_id) VALUES (?, ?)'
    );
    const checkUser = db.prepare('SELECT id FROM users WHERE id = ?');

    for (const memberId of memberIds) {
      if (checkUser.get(memberId)) {
        insertMember.run(groupId, memberId);
      }
    }

    return groupId;
  });

  const groupId = createGroup();
  res.redirect(`/dm/${groupId}`);
});

router.get('/:id', (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(404).render('error', { message: 'グループが見つかりません。', statusCode: 404 });
  }

  const membership = db.prepare(
    'SELECT 1 FROM dm_group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, req.session.userId);

  if (!membership) {
    return res.status(403).render('error', { message: 'このグループへのアクセス権がありません。', statusCode: 403 });
  }

  const group = db.prepare('SELECT id, name, created_by, created_at FROM dm_groups WHERE id = ?').get(groupId);
  if (!group) {
    return res.status(404).render('error', { message: 'グループが見つかりません。', statusCode: 404 });
  }

  const members = db.prepare(`
    SELECT u.id, u.display_name
    FROM users u
    JOIN dm_group_members m ON u.id = m.user_id
    WHERE m.group_id = ?
    ORDER BY u.display_name
  `).all(groupId);

  const messages = db.prepare(`
    SELECT dm.id, dm.content, dm.created_at, u.display_name
    FROM dm_messages dm
    JOIN users u ON dm.user_id = u.id
    WHERE dm.group_id = ?
    ORDER BY dm.created_at ASC
    LIMIT 200
  `).all(groupId);

  res.render('dm/group', { group, members, messages });
});

router.post('/:id/message', (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(404).render('error', { message: 'グループが見つかりません。', statusCode: 404 });
  }

  const membership = db.prepare(
    'SELECT 1 FROM dm_group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, req.session.userId);

  if (!membership) {
    return res.status(403).render('error', { message: 'このグループへのアクセス権がありません。', statusCode: 403 });
  }

  const content = (req.body.content || '').trim();
  if (!content || content.length > 1000) {
    req.session.flash = { type: 'error', message: 'メッセージは1〜1000文字で入力してください。' };
    return res.redirect(`/dm/${groupId}`);
  }

  db.prepare('INSERT INTO dm_messages (group_id, user_id, content) VALUES (?, ?, ?)')
    .run(groupId, req.session.userId, content);

  res.redirect(`/dm/${groupId}`);
});

module.exports = router;
