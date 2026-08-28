const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ab000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ab000000-0000-0000-0000-000000000002';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('GET /admin/roles', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Roles Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ar-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
    await db('roles').insert({ tenant_id: TENANT_ID, name: 'Reviewer' });
  });

  afterAll(async () => {
    await db('roles').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it("lists the tenant's roles", async () => {
    const response = await request(app).get('/admin/roles').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.some((r) => r.name === 'Reviewer')).toBe(true);
  });
});
