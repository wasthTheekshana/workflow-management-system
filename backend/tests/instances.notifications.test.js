const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'd1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'd1000000-0000-0000-0000-000000000002';
const STAGE1_USER = 'd1000000-0000-0000-0000-000000000003';
const STAGE2_USER = 'd1000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const stage1Token = signToken({ sub: STAGE1_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('notifications enqueued by workflow transitions', () => {
  let instanceId;
  let documentTypeId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Instance Notifications Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'notif-inst-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STAGE1_USER, tenant_id: TENANT_ID, email: 'notif-inst-stage1@example.com', password_hash: 'x' },
        { id: STAGE2_USER, tenant_id: TENANT_ID, email: 'notif-inst-stage2@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Notif Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Notif Approval' });
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
        name: 'Notif Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;
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

  it('enqueues an "assigned" notification to the stage 1 assignee on start', async () => {
    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ documentTypeId });
    instanceId = started.body.id;

    const rows = await db('notifications').where({ tenant_id: TENANT_ID, workflow_instance_id: instanceId });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_email).toBe('notif-inst-stage1@example.com');
    expect(rows[0].subject).toContain('New task');
  });

  it('enqueues a "forwarded" notification to the new stage assignee on forward', async () => {
    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});

    const rows = await db('notifications').where({
      tenant_id: TENANT_ID,
      workflow_instance_id: instanceId,
      recipient_email: 'notif-inst-stage2@example.com',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toContain('forwarded to you');
  });

  it('enqueues a "rejected" notification to the original submitter on reject', async () => {
    const stage2Token = signToken({ sub: STAGE2_USER, tenant_id: TENANT_ID, is_admin: false });
    await request(app)
      .post(`/instances/${instanceId}/reject`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ comment: 'Not acceptable' });

    const rows = await db('notifications').where({
      tenant_id: TENANT_ID,
      workflow_instance_id: instanceId,
      recipient_email: 'notif-inst-stage1@example.com',
    });
    const rejectionRow = rows.find((r) => r.subject.includes('rejected'));
    expect(rejectionRow).toBeDefined();
    expect(rejectionRow.body).toContain('Not acceptable');
  });
});
