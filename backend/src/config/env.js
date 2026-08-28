require('dotenv').config();

function validateEnv(env = process.env) {
  const errors = [];

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be set and at least 32 characters long');
  }
  if (!env.DB_HOST) errors.push('DB_HOST is required');
  if (!env.DB_PORT) errors.push('DB_PORT is required');
  if (!env.DB_USER) errors.push('DB_USER is required');
  if (!env.DB_PASSWORD) errors.push('DB_PASSWORD is required');
  if (!env.DB_NAME) errors.push('DB_NAME is required');

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.join('\n')}`);
  }

  const isTest = env.NODE_ENV === 'test';
  const databaseName = isTest ? env.DB_NAME_TEST || `${env.DB_NAME}_test` : env.DB_NAME;

  return {
    port: parseInt(env.PORT || '3000', 10),
    nodeEnv: env.NODE_ENV || 'development',
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '1h',
    corsOrigins: (env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    storageDir: env.STORAGE_DIR || './storage',
    smtp: {
      host: env.SMTP_HOST || 'localhost',
      port: parseInt(env.SMTP_PORT || '587', 10),
      secure: env.SMTP_SECURE === 'true',
      // STARTTLS is required by default so a network attacker can't strip
      // encryption on the plaintext-then-upgrade path; only disable this for
      // a local dev relay (e.g. Mailhog) that doesn't speak STARTTLS at all.
      requireTLS: env.SMTP_REQUIRE_TLS !== 'false',
      user: env.SMTP_USER || '',
      password: env.SMTP_PASSWORD || '',
      from: env.SMTP_FROM || 'no-reply@example.com',
    },
    db: {
      host: env.DB_HOST,
      port: parseInt(env.DB_PORT, 10),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: databaseName,
      ssl: env.DB_SSL === 'true',
    },
  };
}

module.exports = { validateEnv };
