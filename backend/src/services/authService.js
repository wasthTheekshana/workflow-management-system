const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { signToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

async function login(email, password) {
  const user = await db('users').where({ email }).first();

  if (!user) {
    throw new AppError(401, INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new AppError(401, INVALID_CREDENTIALS_MESSAGE);
  }

  const token = signToken({
    sub: user.id,
    tenant_id: user.tenant_id,
    is_admin: user.is_admin,
  });

  return { token };
}

module.exports = { login };
