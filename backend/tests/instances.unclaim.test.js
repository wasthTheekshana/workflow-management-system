const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'f1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'f1000000-0000-0000-0000-000000000002';
const REVIEWER_A_ID = 'f1000000-0000-0000-0000-000000000003';
const REVIEWER_B_ID = 'f1000000-0000-0000-0000-000000000004';
const OUTSIDER_ID = 'f1000000-0000-0000-0000-000000000005';

const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const reviewerAToken = signToken({ sub: REVIEWER_A_ID, tenant_id: TENANT_ID, is_admin: false });
const reviewerBToken = signToken({ sub: REVIEWER_B_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });

const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('unclaiming / releasing a claimed workflow instance', () => {
  let roleId;
  let documentTypeId;
  let roleInstanceId;
  let userInstanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Unclaim Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'unclaim-admin@example.com', password_hash: 'x', is_admin: true },
        { id: REVIEWER_A_ID, tenant_id: TENANT_ID, email: 'unclaim-rev-a@example.com', password_hash: 'x' },
        { id: REVIEWER_B_ID, tenant_id: TENANT_ID, email: 'unclaim-rev-b@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'unclaim-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const [role] = await db('roles').insert({ tenant_id: TENANT_ID, name: 'Review Team' }).returning('id');
    roleId = role.id;
    await db('user_roles').insert([
      { tenant_id: TENANT_ID, user_id: REVIEWER_A_ID, role_id: roleId },
      { tenant_id: TENANT_ID, user_id: REVIEWER_B_ID, role_id: roleId },
    ]);

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Unclaim Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    // Template with role stage
    const workflowTemplateRole = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Role Workflow' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateRole.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Triage', assigneeType: 'role', assigneeRoleId: roleId });

    // Template with direct user stage
    const workflowTemplateUser = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'User Workflow' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateUser.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Direct User', assigneeType: 'user', assigneeUserId: REVIEWER_A_ID });

    const docTypeRole = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Role Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplateRole.body.id,
      });
    documentTypeId = docTypeRole.body.id;

    const docTypeUser = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'User Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplateUser.body.id,
      });

    const startRoleRes = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerAToken}`)
      .send({ documentTypeId });
    roleInstanceId = startRoleRes.body.id;

    const startUserRes = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerAToken}`)
      .send({ documentTypeId: docTypeUser.body.id });
    userInstanceId = startUserRes.body.id;
  });

  afterAll(async () => {
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('user_roles').where({ tenant_id: TENANT_ID }).del();
    await db('roles').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('fails to unclaim when stage is not role- or group-assigned', async () => {
    const res = await request(app)
      .post(`/instances/${userInstanceId}/unclaim`)
      .set('Authorization', `Bearer ${reviewerAToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unclaiming does not apply/i);
  });

  it('fails to unclaim when instance is not currently claimed', async () => {
    const res = await request(app)
      .post(`/instances/${roleInstanceId}/unclaim`)
      .set('Authorization', `Bearer ${reviewerAToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not currently claimed/i);
  });

  it('allows claiming, blocks non-claimant unclaim, then lets claimant unclaim', async () => {
    // 1. Reviewer A claims the instance
    const claimRes = await request(app)
      .post(`/instances/${roleInstanceId}/claim`)
      .set('Authorization', `Bearer ${reviewerAToken}`);
    expect(claimRes.status).toBe(200);
    expect(claimRes.body.claimed_by).toBe(REVIEWER_A_ID);

    // 2. Outsider or Reviewer B tries to unclaim (should fail 403)
    const unauthorizedUnclaim = await request(app)
      .post(`/instances/${roleInstanceId}/unclaim`)
      .set('Authorization', `Bearer ${reviewerBToken}`);
    expect(unauthorizedUnclaim.status).toBe(403);
    expect(unauthorizedUnclaim.body.error).toMatch(/not the claimant/i);

    // 3. Reviewer A unclaims
    const unclaimRes = await request(app)
      .post(`/instances/${roleInstanceId}/unclaim`)
      .set('Authorization', `Bearer ${reviewerAToken}`);
    expect(unclaimRes.status).toBe(200);
    expect(unclaimRes.body.claimed_by).toBeNull();

    // Verify audit log has 'unclaim' action
    const actions = await db('stage_actions')
      .where({ tenant_id: TENANT_ID, workflow_instance_id: roleInstanceId, action_type: 'unclaim' });
    expect(actions).toHaveLength(1);
    expect(actions[0].actor_id).toBe(REVIEWER_A_ID);

    // 4. Reviewer B can now claim it
    const claimBRes = await request(app)
      .post(`/instances/${roleInstanceId}/claim`)
      .set('Authorization', `Bearer ${reviewerBToken}`);
    expect(claimBRes.status).toBe(200);
    expect(claimBRes.body.claimed_by).toBe(REVIEWER_B_ID);
  });

  it('allows an admin to unclaim an instance claimed by another user', async () => {
    // Reviewer B currently holds the claim. Admin unclaims it.
    const adminUnclaim = await request(app)
      .post(`/instances/${roleInstanceId}/unclaim`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminUnclaim.status).toBe(200);
    expect(adminUnclaim.body.claimed_by).toBeNull();

    // Verify instance is now unassigned
    const instanceRow = await db('workflow_instances').where({ id: roleInstanceId }).first();
    expect(instanceRow.claimed_by).toBeNull();
  });
});
