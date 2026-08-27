const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c6000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c6000000-0000-0000-0000-000000000002';
const STUCK_USER = 'c6000000-0000-0000-0000-000000000003';
const REPLACEMENT_USER = 'c6000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const replacementToken = signToken({ sub: REPLACEMENT_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('admin reassignment', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Reassign Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'reassign-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STUCK_USER, tenant_id: TENANT_ID, email: 'reassign-stuck@example.com', password_hash: 'x' },
        { id: REPLACEMENT_USER, tenant_id: TENANT_ID, email: 'reassign-repl@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reassign Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reassign Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: STUCK_USER });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Reassign Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;
  });

  afterAll(async () => {
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

  it('lets an admin reassign the stuck instance to a replacement user, who can then act on it', async () => {
    const reassignResponse = await request(app)
      .post(`/admin/instances/${instanceId}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: REPLACEMENT_USER, comment: 'Original assignee is on leave' });
    expect(reassignResponse.status).toBe(200);
    expect(reassignResponse.body.claimed_by).toBe(REPLACEMENT_USER);

    const forwardResponse = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${replacementToken}`)
      .send({});
    expect(forwardResponse.status).toBe(200);
  });

  it('rejects reassignment from a non-admin', async () => {
    const response = await request(app)
      .post(`/admin/instances/${instanceId}/reassign`)
      .set('Authorization', `Bearer ${replacementToken}`)
      .send({ userId: REPLACEMENT_USER });
    expect(response.status).toBe(403);
  });
});
