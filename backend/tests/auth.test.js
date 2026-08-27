const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/config/db');

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('POST /auth/login', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Test Tenant' }).onConflict('id').ignore();
    const passwordHash = await bcrypt.hash('correct-password', 10);
    await db('users')
      .insert({
        id: USER_ID,
        tenant_id: TENANT_ID,
        email: 'login-test@example.com',
        password_hash: passwordHash,
        is_admin: true,
      })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('users').where({ id: USER_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('returns a JWT for valid credentials', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'login-test@example.com', password: 'correct-password' });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');
  });

  it('returns 401 with a generic message for a wrong password', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'login-test@example.com', password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 401 with the same generic message for an unknown email', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 400 when email or password is missing', async () => {
    const response = await request(app).post('/auth/login').send({ password: 'x' });
    expect(response.status).toBe(400);
  });
});
