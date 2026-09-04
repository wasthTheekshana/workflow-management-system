const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'e0000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'e0000000-0000-0000-0000-000000000002';
const SUBMITTER_ID = 'e0000000-0000-0000-0000-000000000003';
const REVIEWER_ID = 'e0000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const submitterToken = signToken({ sub: SUBMITTER_ID, tenant_id: TENANT_ID, is_admin: false });
const reviewerToken = signToken({ sub: REVIEWER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('GET /instances/my-tasks', () => {
  let documentTypeId;
  let assignedInstanceId;
  let waitingInstanceId;
  let completedInstanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'My Tasks Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'mt-admin@example.com', password_hash: 'x', is_admin: true },
        { id: SUBMITTER_ID, tenant_id: TENANT_ID, email: 'mt-submitter@example.com', password_hash: 'x' },
        { id: REVIEWER_ID, tenant_id: TENANT_ID, email: 'mt-reviewer@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'My Tasks Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'My Tasks Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Review', assigneeType: 'user', assigneeUserId: REVIEWER_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'My Tasks Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;

    // Instance 1: submitted by SUBMITTER, sitting at REVIEWER's desk.
    const started1 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${submitterToken}`)
      .send({ documentTypeId });
    assignedInstanceId = started1.body.id;
    waitingInstanceId = started1.body.id;

    // Instance 2: submitted by SUBMITTER, forwarded past REVIEWER, now completed.
    const started2 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${submitterToken}`)
      .send({ documentTypeId });
    completedInstanceId = started2.body.id;
    await request(app)
      .post(`/instances/${completedInstanceId}/forward`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({});
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
  });

  it('puts the instance in assignedToMe for the current stage assignee', async () => {
    const response = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${reviewerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.assignedToMe.map((i) => i.id)).toContain(assignedInstanceId);
  });

  it('puts the same instance in waitingOnOthers for the submitter', async () => {
    const response = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${submitterToken}`);
    expect(response.status).toBe(200);
    expect(response.body.waitingOnOthers.map((i) => i.id)).toContain(waitingInstanceId);
    expect(response.body.assignedToMe.map((i) => i.id)).not.toContain(waitingInstanceId);
  });

  it('puts a completed submission in completed for the submitter', async () => {
    const response = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${submitterToken}`);
    expect(response.status).toBe(200);
    expect(response.body.completed.map((i) => i.id)).toContain(completedInstanceId);
  });
});

describe('GET /instances/my-tasks — group-assigned stage', () => {
  const G_TENANT_ID = 'e1000000-0000-0000-0000-000000000001';
  const G_ADMIN_ID = 'e1000000-0000-0000-0000-000000000002';
  const G_SUBMITTER_ID = 'e1000000-0000-0000-0000-000000000003';
  const G_MEMBER_ID = 'e1000000-0000-0000-0000-000000000004';
  const gAdminToken = signToken({ sub: G_ADMIN_ID, tenant_id: G_TENANT_ID, is_admin: true });
  const gSubmitterToken = signToken({ sub: G_SUBMITTER_ID, tenant_id: G_TENANT_ID, is_admin: false });
  const gMemberToken = signToken({ sub: G_MEMBER_ID, tenant_id: G_TENANT_ID, is_admin: false });

  let gInstanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: G_TENANT_ID, name: 'My Tasks Group Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: G_ADMIN_ID, tenant_id: G_TENANT_ID, email: 'gmt-admin@example.com', password_hash: 'x', is_admin: true },
        { id: G_SUBMITTER_ID, tenant_id: G_TENANT_ID, email: 'gmt-submitter@example.com', password_hash: 'x' },
        { id: G_MEMBER_ID, tenant_id: G_TENANT_ID, email: 'gmt-member@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [group] = await db('groups').insert({ tenant_id: G_TENANT_ID, name: 'My Tasks Group' }).returning('id');
    await db('user_groups').insert({ tenant_id: G_TENANT_ID, user_id: G_MEMBER_ID, group_id: group.id });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ name: 'My Tasks Group Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${gAdminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ name: 'My Tasks Group Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ stageOrder: 1, name: 'Review', assigneeType: 'group', assigneeGroupId: group.id });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({
        name: 'My Tasks Group Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${gSubmitterToken}`)
      .send({ documentTypeId: documentType.body.id });
    gInstanceId = started.body.id;
  });

  afterAll(async () => {
    await db('notifications').where({ tenant_id: G_TENANT_ID }).del();
    await db('stage_actions').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: G_TENANT_ID }).del();
    await db('document_types').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: G_TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: G_TENANT_ID }).del();
    await db('template_files').where({ tenant_id: G_TENANT_ID }).del();
    await db('user_groups').where({ tenant_id: G_TENANT_ID }).del();
    await db('groups').where({ tenant_id: G_TENANT_ID }).del();
    await db('users').where({ tenant_id: G_TENANT_ID }).del();
    await db('tenants').where({ id: G_TENANT_ID }).del();
  });

  it('puts an unclaimed group-assigned instance in assignedToMe for a group member', async () => {
    const response = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${gMemberToken}`);
    expect(response.status).toBe(200);
    expect(response.body.assignedToMe.map((i) => i.id)).toContain(gInstanceId);
  });
});

afterAll(async () => {
  await db.destroy();
});
