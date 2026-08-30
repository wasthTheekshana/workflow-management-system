const jwt = require('jsonwebtoken');
const { validateEnv } = require('../config/env');
const AppError = require('./AppError');

const DOWNLOAD_TOKEN_EXPIRES_IN = '5m';
// Distinguishes this token type from a real user session token, even though
// both are signed with the same secret — without this, a leaked download
// token could otherwise be replayed as a Bearer session token (or vice
// versa), since jwt.verify alone can't tell the two apart.
const DOWNLOAD_TOKEN_PURPOSE = 'file-download';

function signDownloadToken(filePath) {
  const config = validateEnv();
  return jwt.sign({ purpose: DOWNLOAD_TOKEN_PURPOSE, filePath }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: DOWNLOAD_TOKEN_EXPIRES_IN,
  });
}

function verifyDownloadToken(token) {
  const config = validateEnv();
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.purpose !== DOWNLOAD_TOKEN_PURPOSE || typeof payload.filePath !== 'string' || !payload.filePath) {
      throw new Error('Token is not a valid download token');
    }
    return { filePath: payload.filePath };
  } catch (err) {
    throw new AppError(401, 'Invalid or expired download token');
  }
}

module.exports = { signDownloadToken, verifyDownloadToken };
