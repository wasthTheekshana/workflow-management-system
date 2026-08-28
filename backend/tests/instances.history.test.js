const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'e1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'e1000000-0000-0000-0000-000000000002';
const STAGE1_USER = 'e1000000-0000-0000-0000-000000000003';
const STAGE2_USER = 'e1000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const stage1Token = signToken({ sub: STAGE1_USER, tenant_id: TENANT_ID, is_admin: false });
const stage2Token = signToken({ sub: STAGE2_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('GET /instances/:id/history', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'History Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'hist-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STAGE1_USER, tenant_id: TENANT_ID, email: 'hist-stage1@example.com', password_hash: 'x' },
        { id: STAGE2_USER, tenant_id: TENANT_ID, email: 'hist-stage2@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'History Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'History Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: STAGE1_USER });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 2, name: 'Review', assigneeType: 'user', assigneeUserId: STAGE2_USER });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'History Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;

    await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .attach('file', validDocxBuffer, 'v2.docx');
    await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .attach('file', validDocxBuffer, 'v3.docx');
    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ comment: 'moving on' });
    await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ comment: 'one more pass' });
  });

  afterAll(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
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

  it('returns the full version history in order', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/history`)
      .set('Authorization', `Bearer ${stage1Token}`);
    expect(response.status).toBe(200);
    expect(response.body.versions.map((v) => v.version_number)).toEqual([1, 2]);
  });

  it('returns the full stage_actions audit log in order, with actors and comments', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/history`)
      .set('Authorization', `Bearer ${stage1Token}`);
    expect(response.body.auditLog.map((a) => a.action_type)).toEqual(['forward', 'send_back']);
    expect(response.body.auditLog[0].actor_id).toBe(STAGE1_USER);
    expect(response.body.auditLog[0].comment).toBe('moving on');
    expect(response.body.auditLog[1].actor_id).toBe(STAGE2_USER);
  });

  it("returns 404 for an instance outside the caller's tenant", async () => {
    const response = await request(app)
      .get('/instances/00000000-0000-0000-0000-000000000099/history')
      .set('Authorization', `Bearer ${stage1Token}`);
    expect(response.status).toBe(404);
  });
});
