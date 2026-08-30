const jwt = require('jsonwebtoken');
const { validateEnv } = require('../config/env');
const AppError = require('./AppError');

const DOWNLOAD_TOKEN_EXPIRES_IN = '5m';

function signDownloadToken(filePath) {
  const config = validateEnv();
  return jwt.sign({ filePath }, config.jwtSecret, { algorithm: 'HS256', expiresIn: DOWNLOAD_TOKEN_EXPIRES_IN });
}

function verifyDownloadToken(token) {
  const config = validateEnv();
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return { filePath: payload.filePath };
  } catch (err) {
    throw new AppError(401, 'Invalid or expired download token');
  }
}

module.exports = { signDownloadToken, verifyDownloadToken };
