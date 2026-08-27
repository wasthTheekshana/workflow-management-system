const AppError = require('../utils/AppError');

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return next(new AppError(403, 'Admin privileges required'));
  }
  return next();
}

module.exports = { requireAdmin };
