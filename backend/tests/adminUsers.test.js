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
    await db.destroy();
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
