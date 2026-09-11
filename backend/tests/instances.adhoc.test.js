const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'd0000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'd0000000-0000-0000-0000-000000000002';
const REVIEWER_ID = 'd0000000-0000-0000-0000-000000000003';
const GROUP_MEMBER_ID = 'd0000000-0000-0000-0000-000000000004';
const OUTSIDER_ID = 'd0000000-0000-0000-0000-000000000005';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const reviewerToken = signToken({ sub: REVIEWER_ID, tenant_id: TENANT_ID, is_admin: false });
const groupMemberToken = signToken({ sub: GROUP_MEMBER_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('ad-hoc workflow instances', () => {
  let adhocDocumentTypeId;
  let predefinedDocumentTypeId;
  let groupId;
  const adhocTemplateIds = [];

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Adhoc Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'adhoc-admin@example.com', password_hash: 'x', is_admin: true },
        { id: REVIEWER_ID, tenant_id: TENANT_ID, email: 'adhoc-reviewer@example.com', password_hash: 'x' },
        { id: GROUP_MEMBER_ID, tenant_id: TENANT_ID, email: 'adhoc-groupmember@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'adhoc-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const group = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Adhoc Finance Group' });
    groupId = group.body.id;
    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: GROUP_MEMBER_ID });
    // The reviewer must share the group to see it (and its members) in their
    // visible pool, which is what ad-hoc stage assignment is validated against.
    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: REVIEWER_ID });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Adhoc Memo Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Adhoc Memo', templateFileId: templateFile.body.id, workflowMode: 'adhoc' });
    adhocDocumentTypeId = documentType.body.id;

    const predefinedWorkflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Predefined Memo Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${predefinedWorkflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: REVIEWER_ID });
    const predefinedDocumentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Predefined Memo',
        templateFileId: templateFile.body.id,
        workflowTemplateId: predefinedWorkflowTemplate.body.id,
      });
    predefinedDocumentTypeId = predefinedDocumentType.body.id;
  });

  afterAll(async () => {
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('instance_versions').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects starting an ad-hoc instance with no stages', async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ documentTypeId: adhocDocumentTypeId });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/stages must be a non-empty array/);
  });

  it('rejects a stage assigneeId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        documentTypeId: adhocDocumentTypeId,
        stages: [{ name: 'Review', assigneeType: 'user', assigneeId: '00000000-0000-0000-0000-000000000099' }],
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/is not visible to you/);
  });

  it('rejects a stage assigned to a tenant user outside the caller\'s visibility scope', async () => {
    // OUTSIDER_ID is in the same tenant but shares no group with the reviewer,
    // so listVisibleUsers never returns them and the assignment must be refused.
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        documentTypeId: adhocDocumentTypeId,
        stages: [{ name: 'Review', assigneeType: 'user', assigneeId: OUTSIDER_ID }],
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/is not visible to you/);

    const orphanTemplates = await db('workflow_templates').where({ tenant_id: TENANT_ID, is_adhoc: true });
    expect(orphanTemplates.length).toBe(adhocTemplateIds.length);
  });

  it('rejects stages supplied for a predefined-workflow document type', async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        documentTypeId: predefinedDocumentTypeId,
        stages: [{ name: 'Review', assigneeType: 'user', assigneeId: REVIEWER_ID }],
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/stages must not be provided/);
  });

  it('builds a private workflow template and progresses through it like a predefined one', async () => {
    const startResponse = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        documentTypeId: adhocDocumentTypeId,
        stages: [
          { name: 'Reviewer sign-off', assigneeType: 'user', assigneeId: REVIEWER_ID },
          { name: 'Finance sign-off', assigneeType: 'group', assigneeId: groupId },
        ],
      });
    expect(startResponse.status).toBe(201);
    const instanceId = startResponse.body.id;
    expect(startResponse.body.workflow_template_id).toBeTruthy();
    adhocTemplateIds.push(startResponse.body.workflow_template_id);

    const detailResponse = await request(app)
      .get(`/instances/${instanceId}`)
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(detailResponse.body.currentStage.name).toBe('Reviewer sign-off');
    expect(detailResponse.body.currentStage.assignee_user_id).toBe(REVIEWER_ID);

    const forwardResponse = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({});
    expect(forwardResponse.status).toBe(200);
    expect(forwardResponse.body.current_stage_order).toBe(2);

    const outsiderClaim = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(outsiderClaim.status).toBe(403);

    const claimResponse = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${groupMemberToken}`);
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.body.claimed_by).toBe(GROUP_MEMBER_ID);

    const rejectResponse = await request(app)
      .post(`/instances/${instanceId}/reject`)
      .set('Authorization', `Bearer ${groupMemberToken}`)
      .send({ comment: 'Missing figures' });
    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body.status).toBe('rejected');

    const resubmitResponse = await request(app)
      .post(`/instances/${instanceId}/resubmit`)
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(resubmitResponse.status).toBe(201);
    expect(resubmitResponse.body.workflow_template_id).toBe(startResponse.body.workflow_template_id);
  });

  it('surfaces the ad-hoc instance under my-tasks for the assigned reviewer', async () => {
    const myTasksResponse = await request(app)
      .get('/instances/my-tasks')
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(myTasksResponse.status).toBe(200);
    const allTasks = [...myTasksResponse.body.assignedToMe, ...myTasksResponse.body.waitingOnOthers];
    const adhocTask = allTasks.find((task) => task.document_type_name === 'Adhoc Memo');
    expect(adhocTask).toBeTruthy();
    expect(adhocTask.currentStage).toBeTruthy();
    expect(adhocTask.currentStage.name).toBe('Reviewer sign-off');
  });

  it('excludes ad-hoc one-off templates from the admin workflow-template list', async () => {
    expect(adhocTemplateIds.length).toBeGreaterThan(0);

    const listResponse = await request(app)
      .get('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);

    const listedIds = listResponse.body.map((template) => template.id);
    adhocTemplateIds.forEach((id) => expect(listedIds).not.toContain(id));
    expect(listResponse.body.every((template) => template.is_adhoc === false)).toBe(true);
    // The curated predefined template is still listed.
    expect(listResponse.body.some((template) => template.name === 'Predefined Memo Approval')).toBe(true);
  });
});
