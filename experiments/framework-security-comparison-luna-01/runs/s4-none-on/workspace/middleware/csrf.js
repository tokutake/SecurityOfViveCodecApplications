'use strict';

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

module.exports = function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (!SAFE_METHODS.has(req.method)) {
    const token = req.body?._csrf || req.headers['x-csrf-token'];
    if (!token || token !== req.session.csrfToken) {
      res.locals.user = res.locals.user || {};
      res.locals.flash = null;
      return res.status(403).render('error', {
        message: 'セキュリティトークンが無効です。ページを再読み込みして再試行してください。',
        statusCode: 403,
      });
    }
  }

  next();
};
