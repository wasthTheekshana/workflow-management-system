const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c2000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c2000000-0000-0000-0000-000000000002';
const CREATOR_ID = 'c2000000-0000-0000-0000-000000000003';
const REVIEWER_ID = 'c2000000-0000-0000-0000-000000000004';
const OUTSIDER_ID = 'c2000000-0000-0000-0000-000000000005';

const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const creatorToken = signToken({ sub: CREATOR_ID, tenant_id: TENANT_ID, is_admin: false });
const reviewerToken = signToken({ sub: REVIEWER_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });

const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('cancelling / aborting workflow instances', () => {
  let documentTypeId;
  let templateFileId;
  let workflowTemplateId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Cancel Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'cancel-admin@example.com', password_hash: 'x', is_admin: true },
        { id: CREATOR_ID, tenant_id: TENANT_ID, email: 'cancel-creator@example.com', password_hash: 'x' },
        { id: REVIEWER_ID, tenant_id: TENANT_ID, email: 'cancel-reviewer@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'cancel-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cancellation Template' });
    templateFileId = templateFile.body.id;

    await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Cancellation Approval' });
    workflowTemplateId = workflowTemplate.body.id;

    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Review', assigneeType: 'user', assigneeUserId: REVIEWER_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Cancellation Doc',
        templateFileId,
        workflowTemplateId,
      });
    documentTypeId = documentType.body.id;
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

  it('rejects cancellation from a user who is not the creator or admin', async () => {
    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ documentTypeId });
    const instanceId = started.body.id;

    const res = await request(app)
      .post(`/instances/${instanceId}/cancel`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ comment: 'Malicious cancel attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the submitter or an admin/i);
  });

  it('allows the creator to cancel their own in-progress instance', async () => {
    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ documentTypeId });
    const instanceId = started.body.id;

    const res = await request(app)
      .post(`/instances/${instanceId}/cancel`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ comment: 'No longer needed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.claimed_by).toBeNull();

    // Verify stage_actions audit log
    const actions = await db('stage_actions')
      .where({ tenant_id: TENANT_ID, workflow_instance_id: instanceId, action_type: 'cancel' });
    expect(actions).toHaveLength(1);
    expect(actions[0].actor_id).toBe(CREATOR_ID);
    expect(actions[0].comment).toBe('No longer needed');

    // Trying to cancel again fails (already cancelled)
    const secondCancel = await request(app)
      .post(`/instances/${instanceId}/cancel`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(secondCancel.status).toBe(400);

    // Progression actions fail on cancelled instance
    const forwardRes = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(forwardRes.status).toBe(400);

    // Creator can resubmit a cancelled instance
    const resubmitRes = await request(app)
      .post(`/instances/${instanceId}/resubmit`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(resubmitRes.status).toBe(201);
    expect(resubmitRes.body.status).toBe('in_progress');
    expect(resubmitRes.body.current_stage_order).toBe(1);
  });

  it('allows an admin to cancel an in-progress instance and notifies the creator', async () => {
    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ documentTypeId });
    const instanceId = started.body.id;

    const res = await request(app)
      .post(`/instances/${instanceId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'Administrative compliance cancellation' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');

    // Verify notification was enqueued for the creator
    const notification = await db('notifications')
      .where({ tenant_id: TENANT_ID, recipient_email: 'cancel-creator@example.com' })
      .orderBy('created_at', 'desc')
      .first();
    expect(notification).toBeTruthy();
    expect(notification.subject).toMatch(/Workflow cancelled/i);
    expect(notification.body).toMatch(/Administrative compliance cancellation/);
  });
});

