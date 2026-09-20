const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const { signToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');
const { transporter, MAIL_FROM } = require('../config/mailer');
const { validateEnv } = require('../config/env');
const { MIN_PASSWORD_LENGTH } = require('./userService');

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

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

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function requestPasswordReset(email, sendMail = transporter.sendMail.bind(transporter)) {
  const user = await db('users').where({ email }).first();
  if (!user) {
    return;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db('password_reset_tokens').where({ tenant_id: user.tenant_id, user_id: user.id, used_at: null }).del();
  await db('password_reset_tokens').insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const { frontendBaseUrl } = validateEnv();
  const resetLink = `${frontendBaseUrl}/reset-password?token=${rawToken}`;

  // Fire the email send without awaiting it: awaiting a real SMTP round-trip
  // here would make the response time (and thus this endpoint) observably
  // different between "email exists" and "email doesn't exist", defeating
  // the enumeration-safety goal of always responding immediately with the
  // same generic message.
  sendMail({
    from: MAIL_FROM,
    to: email,
    subject: 'Reset your password',
    text: `Use this link to reset your password (valid for 1 hour): ${resetLink}`,
  }).catch((err) => {
    console.error('Failed to send password reset email:', err.message);
  });
}

async function resetPassword(rawToken, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(400, `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const tokenHash = hashToken(rawToken);
  const tokenRow = await db('password_reset_tokens')
    .where({ token_hash: tokenHash, used_at: null })
    .where('expires_at', '>', new Date())
    .first();

  if (!tokenRow) {
    throw new AppError(400, 'This reset link is invalid or has expired');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await db.transaction(async (trx) => {
    await trx('users').where({ tenant_id: tokenRow.tenant_id, id: tokenRow.user_id }).update({ password_hash: passwordHash });
    await trx('password_reset_tokens').where({ id: tokenRow.id }).update({ used_at: trx.fn.now() });
  });
}

module.exports = { login, requestPasswordReset, resetPassword };
