const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = '77777777-7777-7777-7777-777777777777';
const ADMIN_ID = '88888888-8888-8888-8888-888888888888';
const OTHER_USER_ID = '99999999-8888-7777-6666-555555555555';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('workflow stages admin API', () => {
  let workflowTemplateId;
  let roleId;
  let groupId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Workflow Stages Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ws-admin@example.com', password_hash: 'x', is_admin: true },
        { id: OTHER_USER_ID, tenant_id: TENANT_ID, email: 'ws-stage1@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [role] = await db('roles').insert({ tenant_id: TENANT_ID, name: 'Reviewer' }).returning('id');
    roleId = role.id;
    const [group] = await db('groups').insert({ tenant_id: TENANT_ID, name: 'Reviewers Group' }).returning('id');
    groupId = group.id;

    const createResponse = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '3-Stage Approval' });
    workflowTemplateId = createResponse.body.id;
  });

  afterAll(async () => {
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('roles').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('adds a user-assigned stage, then a role-assigned stage, in order', async () => {
    const stage1 = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: OTHER_USER_ID });
    expect(stage1.status).toBe(201);

    const stage2 = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 2, name: 'Review', assigneeType: 'role', assigneeRoleId: roleId });
    expect(stage2.status).toBe(201);

    const detail = await request(app)
      .get(`/admin/workflow-templates/${workflowTemplateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.stages.map((s) => s.stage_order)).toEqual([1, 2]);
  });

  it('rejects a duplicate stage_order on the same workflow template', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Duplicate', assigneeType: 'user', assigneeUserId: OTHER_USER_ID });
    expect(response.status).toBe(400);
  });

  it('rejects an assigneeUserId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 3,
        name: 'Bad Assignee',
        assigneeType: 'user',
        assigneeUserId: '00000000-1111-2222-3333-444444444444',
      });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid assigneeType', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 3, name: 'Bad Type', assigneeType: 'robot' });
    expect(response.status).toBe(400);
  });

  it('adds a group-assigned stage', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 4, name: 'Group Review', assigneeType: 'group', assigneeGroupId: groupId });
    expect(response.status).toBe(201);
    expect(response.body.assignee_type).toBe('group');
    expect(response.body.assignee_group_id).toBe(groupId);
  });

  it('rejects an assigneeGroupId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 5,
        name: 'Bad Group',
        assigneeType: 'group',
        assigneeGroupId: '00000000-1111-2222-3333-444444444444',
      });
    expect(response.status).toBe(400);
  });
});
