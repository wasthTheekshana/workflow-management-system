const { verifyToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'Missing or invalid authorization header'));
  }

  try {
    const payload = verifyToken(token);
    req.user = {
      userId: payload.sub,
      tenantId: payload.tenant_id,
      isAdmin: !!payload.is_admin,
    };
    return next();
  } catch (err) {
    return next(new AppError(401, 'Invalid or expired token'));
  }
}

module.exports = { authenticate };
