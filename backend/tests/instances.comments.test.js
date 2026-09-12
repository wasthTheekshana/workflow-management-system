const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'e1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'e1000000-0000-0000-0000-000000000002';
const CREATOR_ID = 'e1000000-0000-0000-0000-000000000003';
const ACTOR_ID = 'e1000000-0000-0000-0000-000000000004';
const GROUP_MEMBER_ID = 'e1000000-0000-0000-0000-000000000005';
const OUTSIDER_ID = 'e1000000-0000-0000-0000-000000000006';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const creatorToken = signToken({ sub: CREATOR_ID, tenant_id: TENANT_ID, is_admin: false });
const actorToken = signToken({ sub: ACTOR_ID, tenant_id: TENANT_ID, is_admin: false });
const groupMemberToken = signToken({ sub: GROUP_MEMBER_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('workflow instance comments', () => {
  let instanceId;
  let creatorEmail;
  let actorEmail;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Comments Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'comments-admin@example.com', password_hash: 'x', is_admin: true },
        { id: CREATOR_ID, tenant_id: TENANT_ID, email: 'comments-creator@example.com', password_hash: 'x' },
        { id: ACTOR_ID, tenant_id: TENANT_ID, email: 'comments-actor@example.com', password_hash: 'x' },
        { id: GROUP_MEMBER_ID, tenant_id: TENANT_ID, email: 'comments-groupmember@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'comments-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    creatorEmail = 'comments-creator@example.com';
    actorEmail = 'comments-actor@example.com';

    const group = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Comments Review Group' });
    await request(app)
      .post(`/admin/groups/${group.body.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: GROUP_MEMBER_ID });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Comments Memo Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Comments Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ACTOR_ID });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 2, name: 'Review', assigneeType: 'group', assigneeGroupId: group.body.id });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comments Memo',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const startResponse = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = startResponse.body.id;
  });

  afterAll(async () => {
    await db('comments').where({ tenant_id: TENANT_ID }).del();
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
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

  it('rejects reading and posting comments from an uninvolved user', async () => {
    const getResponse = await request(app)
      .get(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(getResponse.status).toBe(403);

    const postResponse = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ body: 'Should not be allowed' });
    expect(postResponse.status).toBe(403);
  });

  it('allows the creator to post and read a comment', async () => {
    const postResponse = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ body: 'Please review by Friday' });
    expect(postResponse.status).toBe(201);
    expect(postResponse.body.body).toBe('Please review by Friday');
    expect(postResponse.body.author_name).toBeTruthy();

    const getResponse = await request(app)
      .get(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.some((c) => c.body === 'Please review by Friday')).toBe(true);
  });

  it("allows the current stage's directly assigned user to post a comment", async () => {
    // At this point the instance is still at stage 1 (Draft), directly
    // assigned to ACTOR_ID — this exercises the canAct()-based involvement
    // check specifically, before ACTOR_ID becomes a past actor below.
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ body: 'Drafting now' });
    expect(response.status).toBe(201);
  });

  it('forwards the instance from stage 1 to stage 2 (Review, group-assigned, unclaimed)', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.current_stage_order).toBe(2);
  });

  it('allows a past actor to post a comment after their stage has moved on', async () => {
    // Now that the instance has moved to stage 2, ACTOR_ID is no longer the
    // current assignee — this exercises the stage_actions-actor involvement
    // check instead of canAct().
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ body: 'Forwarded to review' });
    expect(response.status).toBe(201);
  });

  it('allows an unclaimed group-eligible member to post a comment', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${groupMemberToken}`)
      .send({ body: 'On it' });
    expect(response.status).toBe(201);
  });

  it('allows an admin with no other relationship to post a comment', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Admin checking in' });
    expect(response.status).toBe(201);
  });

  it('rejects an empty comment body', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ body: '   ' });
    expect(response.status).toBe(400);
  });

  it("notifies the creator and past actor but not the comment's own author", async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();

    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${groupMemberToken}`)
      .send({ body: 'Notification check' });
    expect(response.status).toBe(201);

    const notifications = await db('notifications').where({ tenant_id: TENANT_ID });
    const recipientEmails = notifications.map((n) => n.recipient_email);
    expect(recipientEmails).toContain(creatorEmail);
    expect(recipientEmails).toContain(actorEmail);
    expect(recipientEmails).not.toContain('comments-groupmember@example.com');
    expect(notifications.every((n) => n.subject.startsWith('New comment:'))).toBe(true);
    expect(recipientEmails).not.toContain('comments-admin@example.com');
    expect(notifications.every((n) => !n.body.includes('Notification check'))).toBe(true);
  });
});
