const bcrypt = require('bcryptjs');
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertRequiredString } = require('../utils/validation');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

async function listUsers(tenantId) {
  return db('users').where({ tenant_id: tenantId }).select('id', 'email', 'full_name', 'is_admin').orderBy('email');
}

async function createUser(tenantId, { email, password, fullName, isAdmin }) {
  assertRequiredString(email, 'email');
  if (!EMAIL_REGEX.test(email)) {
    throw new AppError(400, 'email must be a valid email address');
  }
  assertRequiredString(password, 'password');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const [user] = await db('users')
      .insert({
        tenant_id: tenantId,
        email,
        password_hash: passwordHash,
        full_name: fullName || null,
        is_admin: Boolean(isAdmin),
      })
      .returning(['id', 'email', 'full_name', 'is_admin']);
    return user;
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError(400, 'A user with that email already exists');
    }
    throw err;
  }
}

async function updateOwnProfile(tenantId, userId, { fullName, newPassword }) {
  if (fullName === undefined && newPassword === undefined) {
    throw new AppError(400, 'fullName or newPassword is required');
  }

  const updates = {};

  if (fullName !== undefined) {
    assertRequiredString(fullName, 'fullName');
    updates.full_name = fullName;
  }

  if (newPassword !== undefined) {
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(400, `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    updates.password_hash = await bcrypt.hash(newPassword, 10);
  }

  const [user] = await db('users')
    .where({ tenant_id: tenantId, id: userId })
    .update(updates)
    .returning(['id', 'email', 'full_name', 'is_admin']);

  return user;
}

module.exports = { listUsers, createUser, updateOwnProfile, MIN_PASSWORD_LENGTH };
