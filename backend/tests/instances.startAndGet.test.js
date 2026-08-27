const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c0000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c0000000-0000-0000-0000-000000000002';
const USER_ID = 'c0000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const userToken = signToken({ sub: USER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('start and fetch a workflow instance', () => {
  let documentTypeId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Instances Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'inst-admin@example.com', password_hash: 'x', is_admin: true },
        { id: USER_ID, tenant_id: TENANT_ID, email: 'inst-user@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SRS' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SRS Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: USER_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'SRS',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;
  });

  afterAll(async () => {
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('instance_versions').where({ tenant_id: TENANT_ID }).del();
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

  it('starts an instance at stage 1 and fetches its detail', async () => {
    const startResponse = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ documentTypeId });
    expect(startResponse.status).toBe(201);
    expect(startResponse.body.current_stage_order).toBe(1);
    expect(startResponse.body.status).toBe('in_progress');

    const getResponse = await request(app)
      .get(`/instances/${startResponse.body.id}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.currentStage.name).toBe('Draft');
  });

  it('rejects a documentTypeId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ documentTypeId: '00000000-0000-0000-0000-000000000099' });
    expect(response.status).toBe(400);
  });
});
