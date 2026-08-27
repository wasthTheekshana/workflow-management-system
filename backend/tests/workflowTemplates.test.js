const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = '55555555-5555-5555-5555-555555555555';
const ADMIN_ID = '66666666-6666-6666-6666-666666666666';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('workflow templates admin API', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Workflow Templates Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'wt-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ id: ADMIN_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('creates, lists, and fetches a workflow template with an empty stage list', async () => {
    const createResponse = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '3-Stage Approval' });
    expect(createResponse.status).toBe(201);
    const workflowTemplateId = createResponse.body.id;

    const listResponse = await request(app)
      .get('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((w) => w.id === workflowTemplateId)).toBe(true);

    const detailResponse = await request(app)
      .get(`/admin/workflow-templates/${workflowTemplateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.stages).toEqual([]);
  });

  it('returns 400 when name is missing', async () => {
    const response = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(response.status).toBe(400);
  });
});
