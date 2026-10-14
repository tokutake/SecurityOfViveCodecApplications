'use strict';

module.exports = function requireLogin(req, res, next) {
  if (!req.session?.userId) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  next();
};
