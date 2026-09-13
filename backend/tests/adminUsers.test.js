const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'aa000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'aa000000-0000-0000-0000-000000000002';
const OTHER_USER_ID = 'aa000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const userToken = signToken({ sub: OTHER_USER_ID, tenant_id: TENANT_ID, is_admin: false });

describe('GET /admin/users', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Users Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'au-admin@example.com', password_hash: 'x', is_admin: true },
        { id: OTHER_USER_ID, tenant_id: TENANT_ID, email: 'au-user@example.com', password_hash: 'x', full_name: 'Other User' },
      ])
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
  });

  it('rejects a non-admin', async () => {
    const response = await request(app).get('/admin/users').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
  });

  it("lists the tenant's users without password hashes", async () => {
    const response = await request(app).get('/admin/users').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.some((u) => u.id === OTHER_USER_ID && u.full_name === 'Other User')).toBe(true);
    expect(response.body.every((u) => u.password_hash === undefined)).toBe(true);
  });
});

describe('POST /admin/users', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Users Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'au-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects a non-admin', async () => {
    const response = await request(app)
      .post('/admin/users')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ email: 'blocked@example.com', password: 'password123' });
    expect(response.status).toBe(403);
  });

  it('creates a user with a hashed password and no password in the response', async () => {
    const response = await request(app)
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'new-user@example.com', password: 'password123', fullName: 'New User', isAdmin: false });
    expect(response.status).toBe(201);
    expect(response.body.email).toBe('new-user@example.com');
    expect(response.body.full_name).toBe('New User');
    expect(response.body.is_admin).toBe(false);
    expect(response.body.password).toBeUndefined();
    expect(response.body.password_hash).toBeUndefined();

    const stored = await db('users').where({ tenant_id: TENANT_ID, email: 'new-user@example.com' }).first();
    expect(stored.password_hash).not.toBe('password123');
  });

  it('rejects a duplicate email with 400', async () => {
    const response = await request(app)
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'new-user@example.com', password: 'password123' });
    expect(response.status).toBe(400);
  });

  it('rejects a missing password with 400', async () => {
    const response = await request(app)
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'no-password@example.com' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid email with 400', async () => {
    const response = await request(app)
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email', password: 'password123' });
    expect(response.status).toBe(400);
  });
});
