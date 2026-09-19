const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_A = 'e1000000-0000-0000-0000-000000000001';
const ADMIN_A = 'e1000000-0000-0000-0000-000000000002';
const USER_A1 = 'e1000000-0000-0000-0000-000000000003';
const USER_A2 = 'e1000000-0000-0000-0000-000000000004';
const USER_A3 = 'e1000000-0000-0000-0000-000000000005';
const USER_OUTSIDER = 'e1000000-0000-0000-0000-000000000006';

const TENANT_B = 'e2000000-0000-0000-0000-000000000001';
const USER_B1 = 'e2000000-0000-0000-0000-000000000002';

const adminTokenA = signToken({ sub: ADMIN_A, tenant_id: TENANT_A, is_admin: true });
const user1TokenA = signToken({ sub: USER_A1, tenant_id: TENANT_A, is_admin: false });
const user2TokenA = signToken({ sub: USER_A2, tenant_id: TENANT_A, is_admin: false });
const user3TokenA = signToken({ sub: USER_A3, tenant_id: TENANT_A, is_admin: false });
const outsiderTokenA = signToken({ sub: USER_OUTSIDER, tenant_id: TENANT_A, is_admin: false });
const userTokenB = signToken({ sub: USER_B1, tenant_id: TENANT_B, is_admin: false });

const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('Parallel Stage Execution (AND / OR Consensus / Split & Join)', () => {
  let groupId;
  let andWorkflowTemplateId;
  let orWorkflowTemplateId;
  let andDocTypeId;
  let orDocTypeId;

  beforeAll(async () => {
    // Setup tenants
    await db('tenants').insert([
      { id: TENANT_A, name: 'Consensus Tenant A' },
      { id: TENANT_B, name: 'Consensus Tenant B' },
    ]).onConflict('id').ignore();

    // Setup users
    await db('users').insert([
      { id: ADMIN_A, tenant_id: TENANT_A, email: 'admin-consensus@example.com', password_hash: 'x', is_admin: true },
      { id: USER_A1, tenant_id: TENANT_A, email: 'approver1@example.com', password_hash: 'x' },
      { id: USER_A2, tenant_id: TENANT_A, email: 'approver2@example.com', password_hash: 'x' },
      { id: USER_A3, tenant_id: TENANT_A, email: 'approver3@example.com', password_hash: 'x' },
      { id: USER_OUTSIDER, tenant_id: TENANT_A, email: 'outsider@example.com', password_hash: 'x' },
      { id: USER_B1, tenant_id: TENANT_B, email: 'user-b@example.com', password_hash: 'x' },
    ]).onConflict('id').ignore();

    // Create Group with 3 members
    const grpRes = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ name: 'Finance Board' });
    groupId = grpRes.body.id;

    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ userId: USER_A1, level: 1 });

    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ userId: USER_A2, level: 1 });

    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ userId: USER_A3, level: 1 });

    // Setup Template Files
    const tf = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ name: 'Consensus Form' });

    await request(app)
      .post(`/admin/template-files/${tf.body.id}/versions`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .attach('file', validDocxBuffer, 'template.docx');

    // 1. Setup AND Consensus Template (Stage 1: AND Consensus across 3 group members, Stage 2: Final User)
    const andWt = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ name: 'AND Consensus Workflow' });
    andWorkflowTemplateId = andWt.body.id;

    await request(app)
      .post(`/admin/workflow-templates/${andWorkflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        stageOrder: 1,
        name: 'Finance Board Approval (AND)',
        assigneeType: 'group',
        assigneeGroupId: groupId,
        consensusType: 'all',
        slaHours: 24,
      });

    await request(app)
      .post(`/admin/workflow-templates/${andWorkflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        stageOrder: 2,
        name: 'Executive Sign-off',
        assigneeType: 'user',
        assigneeUserId: ADMIN_A,
        consensusType: 'single',
      });

    const andDt = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        name: 'Budget Approval',
        templateFileId: tf.body.id,
        workflowTemplateId: andWorkflowTemplateId,
      });
    andDocTypeId = andDt.body.id;

    // 2. Setup OR Consensus Template (Stage 1: OR Consensus across group members, Stage 2: Final User)
    const orWt = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ name: 'OR Consensus Workflow' });
    orWorkflowTemplateId = orWt.body.id;

    await request(app)
      .post(`/admin/workflow-templates/${orWorkflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        stageOrder: 1,
        name: 'Finance Fast-Track (OR)',
        assigneeType: 'group',
        assigneeGroupId: groupId,
        consensusType: 'any',
      });

    await request(app)
      .post(`/admin/workflow-templates/${orWorkflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        stageOrder: 2,
        name: 'Archive',
        assigneeType: 'user',
        assigneeUserId: ADMIN_A,
        consensusType: 'single',
      });

    const orDt = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        name: 'Urgent Expense',
        templateFileId: tf.body.id,
        workflowTemplateId: orWorkflowTemplateId,
      });
    orDocTypeId = orDt.body.id;
  });

  afterAll(async () => {
    await db('instance_stage_approvals').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('stage_actions').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('workflow_instances').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('document_types').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('workflow_stages').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('workflow_templates').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('template_file_versions').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('template_files').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('user_groups').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('groups').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('users').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('tenants').whereIn('id', [TENANT_A, TENANT_B]).del();
  });

  describe('AND Consensus (Require All Approvals)', () => {
    let instanceId;

    it('creates an instance and inspects initial consensus status (0 of 3 approved)', async () => {
      const res = await request(app)
        .post('/instances')
        .set('Authorization', `Bearer ${user1TokenA}`)
        .send({ documentTypeId: andDocTypeId });

      expect(res.status).toBe(201);
      instanceId = res.body.id;

      const detailRes = await request(app)
        .get(`/instances/${instanceId}`)
        .set('Authorization', `Bearer ${user1TokenA}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.currentStage.consensus_type).toBe('all');
      expect(detailRes.body.stageApprovals).toBeDefined();
      expect(detailRes.body.stageApprovals.consensusType).toBe('all');
      expect(detailRes.body.stageApprovals.totalRequired).toBe(3);
      expect(detailRes.body.stageApprovals.approvedCount).toBe(0);
      expect(detailRes.body.stageApprovals.consensusReached).toBe(false);
      expect(detailRes.body.stageApprovals.eligibleApprovers.length).toBe(3);
    });

    it('rejects claim attempts on AND consensus stages with 400', async () => {
      const res = await request(app)
        .post(`/instances/${instanceId}/claim`)
        .set('Authorization', `Bearer ${user1TokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('parallel AND consensus');
    });

    it('rejects approval from non-eligible user with 403', async () => {
      const res = await request(app)
        .post(`/instances/${instanceId}/forward`)
        .set('Authorization', `Bearer ${outsiderTokenA}`)
        .send({ comment: 'Unauthorized approval attempt' });

      expect(res.status).toBe(403);
    });

    it('records first approver vote; keeps instance at stage 1 (1 of 3)', async () => {
      const res = await request(app)
        .post(`/instances/${instanceId}/forward`)
        .set('Authorization', `Bearer ${user1TokenA}`)
        .send({ comment: 'Approved by Approver 1' });

      expect(res.status).toBe(200);
      expect(res.body.current_stage_order).toBe(1);
      expect(res.body.consensus.reached).toBe(false);
      expect(res.body.consensus.approvedCount).toBe(1);
      expect(res.body.consensus.totalRequired).toBe(3);

      const checkRes = await request(app)
        .get(`/instances/${instanceId}/stage-approvals`)
        .set('Authorization', `Bearer ${user1TokenA}`);

      expect(checkRes.status).toBe(200);
      expect(checkRes.body.approvedCount).toBe(1);
      const app1 = checkRes.body.eligibleApprovers.find((a) => a.id === USER_A1);
      expect(app1.hasApproved).toBe(true);
      expect(app1.comment).toBe('Approved by Approver 1');
    });

    it('rejects duplicate approval from the same approver with 400', async () => {
      const res = await request(app)
        .post(`/instances/${instanceId}/forward`)
        .set('Authorization', `Bearer ${user1TokenA}`)
        .send({ comment: 'Duplicate attempt' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already submitted');
    });

    it('records second approver vote; keeps instance at stage 1 (2 of 3)', async () => {
      const res = await request(app)
        .post(`/instances/${instanceId}/forward`)
        .set('Authorization', `Bearer ${user2TokenA}`)
        .send({ comment: 'Looks good to me' });

      expect(res.status).toBe(200);
      expect(res.body.current_stage_order).toBe(1);
      expect(res.body.consensus.reached).toBe(false);
      expect(res.body.consensus.approvedCount).toBe(2);
    });

    it('records third approver vote; consensus met! advances to Stage 2 (3 of 3)', async () => {
      const res = await request(app)
        .post(`/instances/${instanceId}/forward`)
        .set('Authorization', `Bearer ${user3TokenA}`)
        .send({ comment: 'Final board approval granted' });

      expect(res.status).toBe(200);
      expect(res.body.current_stage_order).toBe(2);
      expect(res.body.consensus.reached).toBe(true);

      const detail = await request(app)
        .get(`/instances/${instanceId}`)
        .set('Authorization', `Bearer ${user3TokenA}`);

      expect(detail.body.current_stage_order).toBe(2);
      expect(detail.body.currentStage.name).toBe('Executive Sign-off');
    });
  });

  describe('OR Consensus (Require Any Approval)', () => {
    let instanceId;

    it('advances immediately to next stage upon single approval', async () => {
      const res = await request(app)
        .post('/instances')
        .set('Authorization', `Bearer ${user1TokenA}`)
        .send({ documentTypeId: orDocTypeId });

      expect(res.status).toBe(201);
      instanceId = res.body.id;

      // Single approver approves in OR stage
      const forwardRes = await request(app)
        .post(`/instances/${instanceId}/forward`)
        .set('Authorization', `Bearer ${user2TokenA}`)
        .send({ comment: 'Fast-tracked by Approver 2' });

      expect(forwardRes.status).toBe(200);
      expect(forwardRes.body.current_stage_order).toBe(2);
      expect(forwardRes.body.consensus.type).toBe('any');
      expect(forwardRes.body.consensus.reached).toBe(true);
    });
  });

  describe('Rejection & Send-back in Consensus Stages', () => {
    it('marks instance as rejected when an approver rejects at an AND stage', async () => {
      const startRes = await request(app)
        .post('/instances')
        .set('Authorization', `Bearer ${user1TokenA}`)
        .send({ documentTypeId: andDocTypeId });

      const instanceId = startRes.body.id;

      // Approver 1 approves
      await request(app)
        .post(`/instances/${instanceId}/forward`)
        .set('Authorization', `Bearer ${user1TokenA}`);

      // Approver 2 rejects
      const rejectRes = await request(app)
        .post(`/instances/${instanceId}/reject`)
        .set('Authorization', `Bearer ${user2TokenA}`)
        .send({ comment: 'Budget numbers inconsistent' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('rejected');

      const auditRes = await request(app)
        .get(`/instances/${instanceId}/history`)
        .set('Authorization', `Bearer ${user1TokenA}`);

      const rejectAction = auditRes.body.auditLog.find((a) => a.action_type === 'reject');
      expect(rejectAction).toBeDefined();
      expect(rejectAction.comment).toBe('Budget numbers inconsistent');
    });

    it('resets stage approvals when instance is sent back', async () => {
      const startRes = await request(app)
        .post('/instances')
        .set('Authorization', `Bearer ${user1TokenA}`)
        .send({ documentTypeId: andDocTypeId });

      const instanceId = startRes.body.id;

      // All 3 approve Stage 1
      await request(app).post(`/instances/${instanceId}/forward`).set('Authorization', `Bearer ${user1TokenA}`);
      await request(app).post(`/instances/${instanceId}/forward`).set('Authorization', `Bearer ${user2TokenA}`);
      await request(app).post(`/instances/${instanceId}/forward`).set('Authorization', `Bearer ${user3TokenA}`);

      // Instance is at Stage 2
      const stage2Detail = await request(app)
        .get(`/instances/${instanceId}`)
        .set('Authorization', `Bearer ${adminTokenA}`);
      expect(stage2Detail.body.current_stage_order).toBe(2);

      // Executive sends back to Stage 1
      const sendBackRes = await request(app)
        .post(`/instances/${instanceId}/send-back`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ targetStageOrder: 1, comment: 'Please re-verify finance projections' });

      expect(sendBackRes.status).toBe(200);
      expect(sendBackRes.body.current_stage_order).toBe(1);

      // Check stage approvals for Stage 1: should be cleared!
      const approvalsRes = await request(app)
        .get(`/instances/${instanceId}/stage-approvals?stageOrder=1`)
        .set('Authorization', `Bearer ${user1TokenA}`);

      expect(approvalsRes.body.approvedCount).toBe(0);
      expect(approvalsRes.body.eligibleApprovers.every((a) => !a.hasApproved)).toBe(true);
    });

    it('enforces strict tenant isolation on stage approvals', async () => {
      const startRes = await request(app)
        .post('/instances')
        .set('Authorization', `Bearer ${user1TokenA}`)
        .send({ documentTypeId: andDocTypeId });

      const instanceId = startRes.body.id;

      // Tenant B tries to fetch stage approvals for Tenant A instance
      const bRes = await request(app)
        .get(`/instances/${instanceId}/stage-approvals`)
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(bRes.status).toBe(404);
    });
  });
});

