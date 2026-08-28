const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'e2000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'e2000000-0000-0000-0000-000000000002';
const USER_ID = 'e2000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const userToken = signToken({ sub: USER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('GET /admin/instances', () => {
  let documentTypeAId;
  let documentTypeBId;
  let inProgressId;
  let completedId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Overview Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ov-admin@example.com', password_hash: 'x', is_admin: true },
        { id: USER_ID, tenant_id: TENANT_ID, email: 'ov-user@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Overview Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplateA = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Overview Approval A' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateA.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: USER_ID });

    const workflowTemplateB = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Overview Approval B' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateB.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: USER_ID });

    const documentTypeA = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Overview Doc A',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplateA.body.id,
      });
    documentTypeAId = documentTypeA.body.id;

    const documentTypeB = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Overview Doc B',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplateB.body.id,
      });
    documentTypeBId = documentTypeB.body.id;

    const started1 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ documentTypeId: documentTypeAId });
    inProgressId = started1.body.id;

    const started2 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ documentTypeId: documentTypeBId });
    completedId = started2.body.id;
    await request(app)
      .post(`/instances/${completedId}/forward`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
  });

  afterAll(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects a non-admin', async () => {
    const response = await request(app).get('/admin/instances').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
  });

  it('lists all instances for the tenant with no filter', async () => {
    const response = await request(app).get('/admin/instances').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    const ids = response.body.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([inProgressId, completedId]));
  });

  it('filters by status', async () => {
    const response = await request(app)
      .get('/admin/instances?status=completed')
      .set('Authorization', `Bearer ${adminToken}`);
    const ids = response.body.map((i) => i.id);
    expect(ids).toContain(completedId);
    expect(ids).not.toContain(inProgressId);
  });

  it('filters by documentTypeId', async () => {
    const response = await request(app)
      .get(`/admin/instances?documentTypeId=${documentTypeAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const ids = response.body.map((i) => i.id);
    expect(ids).toContain(inProgressId);
    expect(ids).not.toContain(completedId);
  });
});
