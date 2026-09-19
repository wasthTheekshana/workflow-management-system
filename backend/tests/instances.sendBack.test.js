const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c4000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c4000000-0000-0000-0000-000000000002';
const STAGE1_USER = 'c4000000-0000-0000-0000-000000000003';
const STAGE2_USER = 'c4000000-0000-0000-0000-000000000004';
const STAGE3_USER = 'c4000000-0000-0000-0000-000000000005';

const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const stage1Token = signToken({ sub: STAGE1_USER, tenant_id: TENANT_ID, is_admin: false });
const stage2Token = signToken({ sub: STAGE2_USER, tenant_id: TENANT_ID, is_admin: false });
const stage3Token = signToken({ sub: STAGE3_USER, tenant_id: TENANT_ID, is_admin: false });

const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('send-back transition & flexible send-back', () => {
  let instanceId;
  let documentTypeId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Send Back Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'sb-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STAGE1_USER, tenant_id: TENANT_ID, email: 'sb-stage1@example.com', password_hash: 'x' },
        { id: STAGE2_USER, tenant_id: TENANT_ID, email: 'sb-stage2@example.com', password_hash: 'x' },
        { id: STAGE3_USER, tenant_id: TENANT_ID, email: 'sb-stage3@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Send Back Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Send Back Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: STAGE1_USER });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 2, name: 'Review', assigneeType: 'user', assigneeUserId: STAGE2_USER });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 3, name: 'Final Approval', assigneeType: 'user', assigneeUserId: STAGE3_USER });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Send Back Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ documentTypeId });
    instanceId = started.body.id;

    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});
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

  it('sends the instance from stage 2 back to stage 1 (default N-1)', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ comment: 'Needs more detail' });
    expect(response.status).toBe(200);
    expect(response.body.current_stage_order).toBe(1);
    expect(response.body.claimed_by).toBeNull();
  });

  it('rejects sending back from the first stage', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});
    expect(response.status).toBe(400);
  });

  it('supports flexible send-back from stage 3 directly to stage 1 (skipping stage 2)', async () => {
    // Forward from stage 1 -> stage 2
    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});

    // Forward from stage 2 -> stage 3
    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({});

    // Instance is now at stage 3
    const getRes = await request(app)
      .get(`/instances/${instanceId}`)
      .set('Authorization', `Bearer ${stage3Token}`);
    expect(getRes.body.current_stage_order).toBe(3);
    expect(Array.isArray(getRes.body.workflowStages)).toBe(true);
    expect(getRes.body.workflowStages).toHaveLength(3);

    // Send back from stage 3 directly to stage 1
    const response = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage3Token}`)
      .send({ comment: 'Major rework needed, back to author', targetStageOrder: 1 });

    expect(response.status).toBe(200);
    expect(response.body.current_stage_order).toBe(1);
    expect(response.body.claimed_by).toBeNull();

    // Verify stage_actions audit trail shows from 3 to 1
    const action = await db('stage_actions')
      .where({ tenant_id: TENANT_ID, workflow_instance_id: instanceId, action_type: 'send_back' })
      .orderBy('created_at', 'desc')
      .first();

    expect(action.from_stage_order).toBe(3);
    expect(action.to_stage_order).toBe(1);
    expect(action.comment).toBe('Major rework needed, back to author');
  });

  it('rejects invalid targetStageOrder values', async () => {
    // Advance to stage 2
    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});

    // Attempt to send back to current stage (stage 2)
    const sameStageRes = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ targetStageOrder: 2 });
    expect(sameStageRes.status).toBe(400);
    expect(sameStageRes.body.error).toMatch(/targetStageOrder must be an integer/i);

    // Attempt to send back to future stage (stage 3)
    const futureStageRes = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ targetStageOrder: 3 });
    expect(futureStageRes.status).toBe(400);

    // Attempt to send back to stage 0
    const zeroStageRes = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ targetStageOrder: 0 });
    expect(zeroStageRes.status).toBe(400);
  });
});
