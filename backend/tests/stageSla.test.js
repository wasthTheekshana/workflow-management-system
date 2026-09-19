const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'f1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'f1000000-0000-0000-0000-000000000002';
const USER1_ID = 'f1000000-0000-0000-0000-000000000003';
const USER2_ID = 'f1000000-0000-0000-0000-000000000004';
const USER3_ID = 'f1000000-0000-0000-0000-000000000005';

const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const user1Token = signToken({ sub: USER1_ID, tenant_id: TENANT_ID, is_admin: false });
const user2Token = signToken({ sub: USER2_ID, tenant_id: TENANT_ID, is_admin: false });
const user3Token = signToken({ sub: USER3_ID, tenant_id: TENANT_ID, is_admin: false });

const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('Stage SLA & Due Date Tracking', () => {
  let templateFileId;
  let workflowTemplateId;
  let documentTypeId;
  let stage1Id;
  let stage2Id;
  let stage3Id;

  beforeAll(async () => {
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

    await db('tenants').insert({ id: TENANT_ID, name: 'SLA Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'sla-admin@example.com', password_hash: 'x', is_admin: true },
        { id: USER1_ID, tenant_id: TENANT_ID, email: 'sla-user1@example.com', password_hash: 'x' },
        { id: USER2_ID, tenant_id: TENANT_ID, email: 'sla-user2@example.com', password_hash: 'x' },
        { id: USER3_ID, tenant_id: TENANT_ID, email: 'sla-user3@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const tfRes = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SLA Doc Template' });
    templateFileId = tfRes.body.id;

    await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'template.docx');

    const wtRes = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SLA Workflow Template' });
    workflowTemplateId = wtRes.body.id;
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

  it('validates slaHours when adding stages', async () => {
    // Negative SLA
    const negRes = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 1,
        name: 'Draft',
        assigneeType: 'user',
        assigneeUserId: USER1_ID,
        slaHours: -5,
      });
    expect(negRes.status).toBe(400);
    expect(negRes.body.error).toMatch(/slaHours must be a positive integer/i);

    // Non-integer SLA
    const floatRes = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 1,
        name: 'Draft',
        assigneeType: 'user',
        assigneeUserId: USER1_ID,
        slaHours: 'invalid',
      });
    expect(floatRes.status).toBe(400);
  });

  it('creates stages with sla_hours configuration', async () => {
    // Stage 1: SLA 24 hours
    const s1Res = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 1,
        name: 'Drafting',
        assigneeType: 'user',
        assigneeUserId: USER1_ID,
        slaHours: 24,
      });
    expect(s1Res.status).toBe(201);
    expect(s1Res.body.sla_hours).toBe(24);
    stage1Id = s1Res.body.id;

    // Stage 2: SLA 48 hours
    const s2Res = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 2,
        name: 'Review',
        assigneeType: 'user',
        assigneeUserId: USER2_ID,
        slaHours: 48,
      });
    expect(s2Res.status).toBe(201);
    expect(s2Res.body.sla_hours).toBe(48);
    stage2Id = s2Res.body.id;

    // Stage 3: No SLA (null)
    const s3Res = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 3,
        name: 'Approval',
        assigneeType: 'user',
        assigneeUserId: USER3_ID,
      });
    expect(s3Res.status).toBe(201);
    expect(s3Res.body.sla_hours).toBeNull();
    stage3Id = s3Res.body.id;

    // Create document type
    const dtRes = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'SLA Contract Doc',
        templateFileId,
        workflowTemplateId,
      });
    expect(dtRes.status).toBe(201);
    documentTypeId = dtRes.body.id;
  });

  it('updates stage sla_hours in-place', async () => {
    const updateRes = await request(app)
      .put(`/admin/workflow-templates/${workflowTemplateId}/stages/1`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Drafting Updated',
        assigneeType: 'user',
        assigneeUserId: USER1_ID,
        slaHours: 12,
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.sla_hours).toBe(12);

    // Reset back to 24 for downstream tests
    await request(app)
      .put(`/admin/workflow-templates/${workflowTemplateId}/stages/1`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Drafting',
        assigneeType: 'user',
        assigneeUserId: USER1_ID,
        slaHours: 24,
      });
  });

  it('sets stage_entered_at and stage_due_at on workflow instance start', async () => {
    const startRes = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ documentTypeId });

    expect(startRes.status).toBe(201);
    expect(startRes.body.current_stage_order).toBe(1);
    expect(startRes.body.stage_entered_at).toBeDefined();
    expect(startRes.body.stage_due_at).toBeDefined();

    const enteredAt = new Date(startRes.body.stage_entered_at).getTime();
    const dueAt = new Date(startRes.body.stage_due_at).getTime();
    const diffHours = Math.round((dueAt - enteredAt) / (1000 * 3600));
    expect(diffHours).toBe(24);

    // Check GET /instances/:id
    const detailRes = await request(app)
      .get(`/instances/${startRes.body.id}`)
      .set('Authorization', `Bearer ${user1Token}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.is_overdue).toBe(false);
    expect(detailRes.body.currentStage.sla_hours).toBe(24);
  });

  it('updates stage_due_at on forward transition and send-back transition', async () => {
    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ documentTypeId });
    const instanceId = started.body.id;

    // Forward to stage 2 (which has 48h SLA)
    const fwdRes = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ comment: 'Proceed to review' });

    expect(fwdRes.status).toBe(200);
    expect(fwdRes.body.current_stage_order).toBe(2);
    expect(fwdRes.body.stage_entered_at).toBeDefined();
    expect(fwdRes.body.stage_due_at).toBeDefined();

    const entered2 = new Date(fwdRes.body.stage_entered_at).getTime();
    const due2 = new Date(fwdRes.body.stage_due_at).getTime();
    const diff2 = Math.round((due2 - entered2) / (1000 * 3600));
    expect(diff2).toBe(48);

    // Send back to stage 1 (which has 24h SLA)
    const sbRes = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ comment: 'Please revise', targetStageOrder: 1 });

    expect(sbRes.status).toBe(200);
    expect(sbRes.body.current_stage_order).toBe(1);

    const entered1 = new Date(sbRes.body.stage_entered_at).getTime();
    const due1 = new Date(sbRes.body.stage_due_at).getTime();
    const diff1 = Math.round((due1 - entered1) / (1000 * 3600));
    expect(diff1).toBe(24);
  });

  it('clears stage_due_at when workflow instance completes or is cancelled', async () => {
    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ documentTypeId });
    const instanceId = started.body.id;

    // Forward to stage 2
    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({});

    // Forward to stage 3 (which has no SLA)
    const fwd3 = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({});
    expect(fwd3.body.current_stage_order).toBe(3);
    expect(fwd3.body.stage_due_at).toBeNull();

    // Forward to completion
    const fwdComplete = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${user3Token}`)
      .send({});
    expect(fwdComplete.body.status).toBe('completed');
    expect(fwdComplete.body.stage_due_at).toBeNull();

    // Test cancellation clears stage_due_at
    const start2 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ documentTypeId });
    expect(start2.body.stage_due_at).toBeDefined();

    const cancelRes = await request(app)
      .post(`/instances/${start2.body.id}/cancel`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ comment: 'Cancelling' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('cancelled');
    expect(cancelRes.body.stage_due_at).toBeNull();
  });

  it('accurately identifies overdue tasks in listMyTasks and admin instances', async () => {
    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ documentTypeId });
    const instanceId = started.body.id;

    // Manually backdate stage_due_at to 2 hours ago
    const pastDueDate = new Date(Date.now() - 2 * 3600 * 1000);
    await db('workflow_instances')
      .where({ tenant_id: TENANT_ID, id: instanceId })
      .update({ stage_due_at: pastDueDate });

    // Check GET /instances/:id
    const detailRes = await request(app)
      .get(`/instances/${instanceId}`)
      .set('Authorization', `Bearer ${user1Token}`);
    expect(detailRes.body.is_overdue).toBe(true);

    // Check listMyTasks
    const myTasksRes = await request(app)
      .get('/instances/my-tasks')
      .set('Authorization', `Bearer ${user1Token}`);
    const myTask = myTasksRes.body.assignedToMe.find((t) => t.id === instanceId);
    expect(myTask).toBeDefined();
    expect(myTask.is_overdue).toBe(true);

    // Check admin instances with filter
    const allAdminRes = await request(app)
      .get('/admin/instances')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminTask = allAdminRes.body.find((t) => t.id === instanceId);
    expect(adminTask).toBeDefined();
    expect(adminTask.is_overdue).toBe(true);

    const overdueOnlyRes = await request(app)
      .get('/admin/instances?isOverdue=true')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(overdueOnlyRes.status).toBe(200);
    expect(overdueOnlyRes.body.every((i) => i.is_overdue)).toBe(true);
    expect(overdueOnlyRes.body.some((i) => i.id === instanceId)).toBe(true);
  });
});

