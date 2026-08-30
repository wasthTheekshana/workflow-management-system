const { validateEnv } = require('../src/config/env');

describe('validateEnv', () => {
  const validBase = {
    JWT_SECRET: 'a'.repeat(32),
    ONLYOFFICE_JWT_SECRET: 'b'.repeat(32),
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'workflow',
    DB_PASSWORD: 'secret',
    DB_NAME: 'workflow_engine',
  };

  it('throws when JWT_SECRET is missing', () => {
    const env = { ...validBase, JWT_SECRET: '' };
    expect(() => validateEnv(env)).toThrow('JWT_SECRET');
  });

  it('throws when JWT_SECRET is shorter than 32 characters', () => {
    const env = { ...validBase, JWT_SECRET: 'too-short' };
    expect(() => validateEnv(env)).toThrow('JWT_SECRET');
  });

  it('throws when a required DB variable is missing', () => {
    const env = { ...validBase, DB_HOST: '' };
    expect(() => validateEnv(env)).toThrow('DB_HOST');
  });

  it('throws when ONLYOFFICE_JWT_SECRET is missing', () => {
    const env = { ...validBase, ONLYOFFICE_JWT_SECRET: '' };
    expect(() => validateEnv(env)).toThrow('ONLYOFFICE_JWT_SECRET');
  });

  it('returns a fully-populated config object for valid input', () => {
    const config = validateEnv(validBase);
    expect(config.jwtSecret).toBe(validBase.JWT_SECRET);
    expect(config.storageDir).toBe('./storage');
    expect(config.smtp).toEqual({
      host: 'localhost',
      port: 587,
      secure: false,
      requireTLS: true,
      user: '',
      password: '',
      from: 'no-reply@example.com',
    });
    expect(config.onlyoffice).toEqual({
      jwtSecret: 'b'.repeat(32),
      documentServerUrl: 'http://localhost:8082',
      callbackBaseUrl: 'http://host.docker.internal:3000',
    });
    expect(config.db).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'workflow',
      password: 'secret',
      database: 'workflow_engine',
      ssl: false,
    });
  });

  it('defaults port to 3000 and jwtExpiresIn to 1h when unset', () => {
    const config = validateEnv(validBase);
    expect(config.port).toBe(3000);
    expect(config.jwtExpiresIn).toBe('1h');
  });
});
