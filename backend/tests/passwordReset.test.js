const request = require('supertest');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const app = require('../src/app');
const db = require('../src/config/db');
const { requestPasswordReset } = require('../src/services/authService');

const TENANT_ID = 'a1000000-0000-0000-0000-000000000001';
const USER_ID = 'a1000000-0000-0000-0000-000000000002';
const OTHER_TENANT_ID = 'a1000000-0000-0000-0000-000000000003';
const OTHER_USER_ID = 'a1000000-0000-0000-0000-000000000004';

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

describe('password reset', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Password Reset Tenant' }).onConflict('id').ignore();
    await db('tenants').insert({ id: OTHER_TENANT_ID, name: 'Other Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({
        id: USER_ID,
        tenant_id: TENANT_ID,
        email: 'pwreset@example.com',
        password_hash: await bcrypt.hash('OldPassword1', 10),
      })
      .onConflict('id')
      .ignore();
    await db('users')
      .insert({
        id: OTHER_USER_ID,
        tenant_id: OTHER_TENANT_ID,
        email: 'other-tenant@example.com',
        password_hash: await bcrypt.hash('OldPassword1', 10),
      })
      .onConflict('id')
      .ignore();
  });

  afterEach(async () => {
    await db('password_reset_tokens').where({ tenant_id: TENANT_ID }).del();
    await db('password_reset_tokens').where({ tenant_id: OTHER_TENANT_ID }).del();
  });

  afterAll(async () => {
    await db('users').whereIn('id', [USER_ID, OTHER_USER_ID]).del();
    await db('tenants').whereIn('id', [TENANT_ID, OTHER_TENANT_ID]).del();
    await db.destroy();
  });

  it('POST /auth/forgot-password returns 200 with a generic message for a real email and creates a token', async () => {
    const response = await request(app).post('/auth/forgot-password').send({ email: 'pwreset@example.com' });
    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/if that email is registered/i);

    const rows = await db('password_reset_tokens').where({ tenant_id: TENANT_ID, user_id: USER_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].used_at).toBeNull();
  });

  it('POST /auth/forgot-password returns the identical 200 response for an unknown email, with no token created', async () => {
    const response = await request(app).post('/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/if that email is registered/i);

    const rows = await db('password_reset_tokens');
    expect(rows).toHaveLength(0);
  });

  it('requesting a second reset invalidates the first token', async () => {
    const sent = [];
    const fakeSendMail = async (mail) => {
      sent.push(mail);
      return {};
    };

    await requestPasswordReset('pwreset@example.com', fakeSendMail);
    const firstLink = sent[0].text.match(/token=([a-f0-9]+)/)[1];

    await requestPasswordReset('pwreset@example.com', fakeSendMail);

    const staleAttempt = await request(app)
      .post('/auth/reset-password')
      .send({ token: firstLink, newPassword: 'BrandNewPassword1' });
    expect(staleAttempt.status).toBe(400);

    const rows = await db('password_reset_tokens').where({ tenant_id: TENANT_ID, user_id: USER_ID });
    expect(rows).toHaveLength(1);
  });

  it('resets the password with a valid token, and the token cannot be reused', async () => {
    const sent = [];
    await requestPasswordReset('pwreset@example.com', async (mail) => {
      sent.push(mail);
      return {};
    });
    const rawToken = sent[0].text.match(/token=([a-f0-9]+)/)[1];

    const resetResponse = await request(app)
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'BrandNewPassword1' });
    expect(resetResponse.status).toBe(200);

    const oldLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'pwreset@example.com', password: 'OldPassword1' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'pwreset@example.com', password: 'BrandNewPassword1' });
    expect(newLogin.status).toBe(200);

    const reuseAttempt = await request(app)
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'AnotherPassword1' });
    expect(reuseAttempt.status).toBe(400);

    const tokenRow = await hashAndFindToken(rawToken);
    expect(tokenRow.used_at).not.toBeNull();
  });

  it('rejects an expired token', async () => {
    const rawToken = 'a'.repeat(64);
    await db('password_reset_tokens').insert({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() - 1000),
    });

    const response = await request(app)
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'BrandNewPassword1' });
    expect(response.status).toBe(400);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const rawToken = 'b'.repeat(64);
    await db('password_reset_tokens').insert({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + 3600000),
    });

    const response = await request(app)
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'short' });
    expect(response.status).toBe(400);
  });

  it('rejects an unknown token', async () => {
    const response = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'c'.repeat(64), newPassword: 'BrandNewPassword1' });
    expect(response.status).toBe(400);
  });

  async function hashAndFindToken(rawToken) {
    return db('password_reset_tokens').where({ token_hash: hashToken(rawToken) }).first();
  }
});
