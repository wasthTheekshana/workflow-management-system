const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ee000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ee000000-0000-0000-0000-000000000002';
const USER_LVL1_ID = 'ee000000-0000-0000-0000-000000000003';
const USER_LVL2_ID = 'ee000000-0000-0000-0000-000000000004';
const TEMPLATE_FILE_ID = 'ee000000-0000-0000-0000-000000000005';
const TEMPLATE_VERSION_ID = 'ee000000-0000-0000-0000-000000000006';

const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const lvl1Token = signToken({ sub: USER_LVL1_ID, tenant_id: TENANT_ID, is_admin: false });
const lvl2Token = signToken({ sub: USER_LVL2_ID, tenant_id: TENANT_ID, is_admin: false });

describe('User Group Levels & Hierarchical Stage Assignment', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Group Levels Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'gl-admin@example.com', password_hash: 'x', is_admin: true },
        { id: USER_LVL1_ID, tenant_id: TENANT_ID, email: 'gl-lvl1@example.com', password_hash: 'x', is_admin: false },
        { id: USER_LVL2_ID, tenant_id: TENANT_ID, email: 'gl-lvl2@example.com', password_hash: 'x', is_admin: false },
      ])
      .onConflict('id')
      .ignore();

    await db('template_files')
      .insert({ id: TEMPLATE_FILE_ID, tenant_id: TENANT_ID, name: 'GL Doc', content_format: 'richtext' })
      .onConflict('id')
      .ignore();

    await db('template_file_versions')
      .insert({
        id: TEMPLATE_VERSION_ID,
        tenant_id: TENANT_ID,
        template_file_id: TEMPLATE_FILE_ID,
        version_number: 1,
        content: { body: 'sample' },
        uploaded_by: ADMIN_ID,
      })
      .onConflict('id')
      .ignore();
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
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('manages member levels in user_groups', async () => {
    // 1. Create group
    const createGroupRes = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HR Department' });
    expect(createGroupRes.status).toBe(201);
    const groupId = createGroupRes.body.id;

    // 2. Add user with default level (1)
    const add1Res = await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: USER_LVL1_ID });
    expect(add1Res.status).toBe(204);

    // 3. Add user with explicit level (2)
    const add2Res = await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: USER_LVL2_ID, level: 2 });
    expect(add2Res.status).toBe(204);

    // 4. Reject invalid level
    const invalidLevelRes = await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: ADMIN_ID, level: -1 });
    expect(invalidLevelRes.status).toBe(400);

    // 5. Inspect group detail — members should have level property
    const detailRes = await request(app)
      .get(`/admin/groups/${groupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    const m1 = detailRes.body.members.find((m) => m.id === USER_LVL1_ID);
    const m2 = detailRes.body.members.find((m) => m.id === USER_LVL2_ID);
    expect(m1).toBeDefined();
    expect(m1.level).toBe(1);
    expect(m2).toBeDefined();
    expect(m2.level).toBe(2);

    // 6. Update member level via PUT
    const updateLvlRes = await request(app)
      .put(`/admin/groups/${groupId}/members/${USER_LVL1_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ level: 3 });
    expect(updateLvlRes.status).toBe(204);

    const updatedDetail = await request(app)
      .get(`/admin/groups/${groupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const updatedM1 = updatedDetail.body.members.find((m) => m.id === USER_LVL1_ID);
    expect(updatedM1.level).toBe(3);

    // Set back to 1 for next tests
    await request(app)
      .put(`/admin/groups/${groupId}/members/${USER_LVL1_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ level: 1 });
  });

  it('enforces group level in stage configuration, claiming, and dashboard', async () => {
    // 1. Fetch the HR group
    const groupsRes = await request(app)
      .get('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`);
    const hrGroup = groupsRes.body.find((g) => g.name === 'HR Department');
    expect(hrGroup).toBeDefined();

    // 2. Create a workflow template
    const templateRes = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HR Review Template' });
    expect(templateRes.status).toBe(201);
    const wfTemplateId = templateRes.body.id;

    // 3. Add Stage 1: assigned to HR Group, Level 2
    const stage1Res = await request(app)
      .post(`/admin/workflow-templates/${wfTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 1,
        name: 'Manager Sign-off',
        assigneeType: 'group',
        assigneeGroupId: hrGroup.id,
        assigneeGroupLevel: 2,
        allowedActions: ['forward', 'send_back', 'reject'],
      });
    expect(stage1Res.status).toBe(201);
    expect(stage1Res.body.assignee_group_level).toBe(2);

    // 4. Create document type
    const docTypeRes = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'HR Request Form',
        templateFileId: TEMPLATE_FILE_ID,
        workflowTemplateId: wfTemplateId,
        allowedExtensions: ['docx'],
        maxUploadSizeBytes: 5 * 1024 * 1024,
      });
    expect(docTypeRes.status).toBe(201);
    const docTypeId = docTypeRes.body.id;

    // 5. Start instance
    const startRes = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ documentTypeId: docTypeId });
    expect(startRes.status).toBe(201);
    const instanceId = startRes.body.id;

    // 6. Level 1 user checks "My Tasks" — should NOT be eligible to claim
    const lvl1Tasks = await request(app)
      .get('/instances/my-tasks')
      .set('Authorization', `Bearer ${lvl1Token}`);
    expect(lvl1Tasks.status).toBe(200);
    expect(lvl1Tasks.body.assignedToMe.some((t) => t.id === instanceId)).toBe(false);

    // 7. Level 1 user attempts to claim — should receive 403 Forbidden
    const lvl1Claim = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${lvl1Token}`);
    expect(lvl1Claim.status).toBe(403);
    expect(lvl1Claim.body.error).toContain('Level 2');

    // 8. Level 2 user checks "My Tasks" — SHOULD be eligible to claim
    const lvl2Tasks = await request(app)
      .get('/instances/my-tasks')
      .set('Authorization', `Bearer ${lvl2Token}`);
    expect(lvl2Tasks.status).toBe(200);
    expect(lvl2Tasks.body.assignedToMe.some((t) => t.id === instanceId)).toBe(true);

    // 9. Level 2 user claims instance — SUCCESS
    const lvl2Claim = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${lvl2Token}`);
    expect(lvl2Claim.status).toBe(200);
    expect(lvl2Claim.body.claimed_by).toBe(USER_LVL2_ID);
  });
});
