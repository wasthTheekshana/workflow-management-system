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
    // Every other JWT this app issues (download tokens, etc.) is signed with
    // the same secret but carries a different shape — require the exact
    // claims a real session token has, so one token type can never be
    // replayed as another and silently produce an unscoped req.user.
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.tenant_id !== 'string' || !payload.tenant_id) {
      throw new Error('Token is missing required session claims');
    }
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
