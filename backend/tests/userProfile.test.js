const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'b1000000-0000-0000-0000-000000000001';
const USER_ID = 'b1000000-0000-0000-0000-000000000002';
const token = signToken({ sub: USER_ID, tenant_id: TENANT_ID, is_admin: false });

describe('PATCH /users/me', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Profile Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({
        id: USER_ID,
        tenant_id: TENANT_ID,
        email: 'profile-test@example.com',
        password_hash: await bcrypt.hash('OriginalPassword1', 10),
        full_name: 'Original Name',
      })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('users').where({ id: USER_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('returns 401 when unauthenticated', async () => {
    const response = await request(app).patch('/users/me').send({ fullName: 'New Name' });
    expect(response.status).toBe(401);
  });

  it('returns 400 when neither fullName nor newPassword is provided', async () => {
    const response = await request(app).patch('/users/me').set('Authorization', `Bearer ${token}`).send({});
    expect(response.status).toBe(400);
  });

  it('returns 400 for a new password shorter than 8 characters', async () => {
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'short' });
    expect(response.status).toBe(400);
  });

  it('updates fullName only', async () => {
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Updated Name' });
    expect(response.status).toBe(200);
    expect(response.body.full_name).toBe('Updated Name');

    const row = await db('users').where({ id: USER_ID }).first();
    expect(row.full_name).toBe('Updated Name');
  });

  it('updates newPassword only, and the new password logs in', async () => {
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'BrandNewPassword2' });
    expect(response.status).toBe(200);

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({ email: 'profile-test@example.com', password: 'BrandNewPassword2' });
    expect(loginResponse.status).toBe(200);
  });

  it('updates both fullName and newPassword together', async () => {
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Both Fields Name', newPassword: 'AnotherPassword3' });
    expect(response.status).toBe(200);
    expect(response.body.full_name).toBe('Both Fields Name');

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({ email: 'profile-test@example.com', password: 'AnotherPassword3' });
    expect(loginResponse.status).toBe(200);
  });

  it('invalidates outstanding password reset tokens when newPassword is changed', async () => {
    // Clean up any existing tokens for this user
    await db('password_reset_tokens').where({ tenant_id: TENANT_ID, user_id: USER_ID }).del();

    // Insert a live, unused password_reset_tokens row for this tenant/user
    await db('password_reset_tokens').insert({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      token_hash: 'test-token-hash-for-invalidation-test',
      expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    });

    // Verify the token exists before the password change
    let tokensBeforeChange = await db('password_reset_tokens')
      .where({ tenant_id: TENANT_ID, user_id: USER_ID, used_at: null });
    expect(tokensBeforeChange.length).toBe(1);

    // Call PATCH /users/me with a newPassword
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'NewPasswordAfterInvalidation9' });
    expect(response.status).toBe(200);

    // Verify the token has been deleted
    let tokensAfterChange = await db('password_reset_tokens')
      .where({ tenant_id: TENANT_ID, user_id: USER_ID, used_at: null });
    expect(tokensAfterChange.length).toBe(0);
  });

  it('does NOT invalidate password reset tokens when only fullName is changed', async () => {
    // Clean up any existing tokens for this user
    await db('password_reset_tokens').where({ tenant_id: TENANT_ID, user_id: USER_ID }).del();

    // Insert a live, unused password_reset_tokens row for this tenant/user
    await db('password_reset_tokens').insert({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      token_hash: 'test-token-hash-for-fullname-only-test',
      expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    });

    // Verify the token exists before the fullName change
    let tokensBeforeChange = await db('password_reset_tokens')
      .where({ tenant_id: TENANT_ID, user_id: USER_ID, used_at: null });
    expect(tokensBeforeChange.length).toBe(1);

    // Call PATCH /users/me with only fullName (no newPassword)
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Updated Name For Token Test' });
    expect(response.status).toBe(200);

    // Verify the token still exists (was NOT deleted)
    let tokensAfterChange = await db('password_reset_tokens')
      .where({ tenant_id: TENANT_ID, user_id: USER_ID, used_at: null });
    expect(tokensAfterChange.length).toBe(1);
  });
});
