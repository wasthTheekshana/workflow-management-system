const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'f1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'f1000000-0000-0000-0000-000000000002';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('security hardening', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Security Hardening Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'sec-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rate-limits repeated login attempts', async () => {
    const attempts = [];
    for (let i = 0; i < 11; i += 1) {
      attempts.push(
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post('/auth/login')
          .send({ email: 'nobody@example.com', password: 'wrong-password' }),
      );
    }

    const statuses = attempts.map((r) => r.status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  }, 15000);

  it('safely stores and round-trips a SQL-injection-shaped string via parameterized queries', async () => {
    const maliciousName = "Robert'); DROP TABLE workflow_templates;--";

    const createResponse = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: maliciousName });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.name).toBe(maliciousName);

    const tableStillExists = await db.schema.hasTable('workflow_templates');
    expect(tableStillExists).toBe(true);

    const listResponse = await request(app)
      .get('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((w) => w.name === maliciousName)).toBe(true);
  });
});
