const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'f1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'f1000000-0000-0000-0000-000000000002';
const CREATOR_ID = 'f1000000-0000-0000-0000-000000000003';
const REVIEWER_ID = 'f1000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const creatorToken = signToken({ sub: CREATOR_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('start an instance from a self-uploaded document', () => {
  let groupId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'From Document Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'fd-admin@example.com', password_hash: 'x', is_admin: true },
        { id: CREATOR_ID, tenant_id: TENANT_ID, email: 'fd-creator@example.com', password_hash: 'x' },
        { id: REVIEWER_ID, tenant_id: TENANT_ID, email: 'fd-reviewer@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const group = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'From Document Group' });
    groupId = group.body.id;
    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: CREATOR_ID });
    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: REVIEWER_ID });
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

  it('starts an instance from an uploaded docx with a stage list', async () => {
    const stages = JSON.stringify([{ name: 'Review', assigneeType: 'user', assigneeId: REVIEWER_ID }]);
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'My Own Memo')
      .field('contentFormat', 'docx')
      .field('stages', stages)
      .attach('file', validDocxBuffer, 'memo.docx');
    expect(response.status).toBe(201);
    const instanceId = response.body.id;

    const detail = await request(app)
      .get(`/instances/${instanceId}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(detail.body.contentFormat).toBe('docx');
    expect(detail.body.currentStage.name).toBe('Review');
    expect(detail.body.currentStage.assignee_user_id).toBe(REVIEWER_ID);

    const download = await request(app)
      .get(`/instances/${instanceId}/current-file`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(download.status).toBe(200);
  });

  it('starts an instance from composed rich text with a stage list', async () => {
    const stages = JSON.stringify([{ name: 'Review', assigneeType: 'group', assigneeId: groupId }]);
    const content = JSON.stringify({ type: 'doc', content: [] });
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'My Rich Text Memo')
      .field('contentFormat', 'richtext')
      .field('stages', stages)
      .field('content', content);
    expect(response.status).toBe(201);
    const instanceId = response.body.id;

    const currentContent = await request(app)
      .get(`/instances/${instanceId}/current-content`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(currentContent.status).toBe(200);
    expect(currentContent.body.content).toEqual({ type: 'doc', content: [] });
  });

  it('rejects contentFormat "docx" with no file', async () => {
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'No File')
      .field('contentFormat', 'docx')
      .field('stages', JSON.stringify([{ name: 'Review', assigneeType: 'user', assigneeId: REVIEWER_ID }]));
    expect(response.status).toBe(400);
  });

  it('rejects contentFormat "richtext" with no content', async () => {
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'No Content')
      .field('contentFormat', 'richtext')
      .field('stages', JSON.stringify([{ name: 'Review', assigneeType: 'user', assigneeId: REVIEWER_ID }]));
    expect(response.status).toBe(400);
  });

  it('rejects a missing stages array', async () => {
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'No Stages')
      .field('contentFormat', 'richtext')
      .field('content', JSON.stringify({ type: 'doc', content: [] }));
    expect(response.status).toBe(400);
  });

  it('excludes the self-service document type and template file from admin lists', async () => {
    const documentTypes = await request(app)
      .get('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(documentTypes.body.some((dt) => dt.name === 'My Own Memo')).toBe(false);

    const templateFiles = await request(app)
      .get('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(templateFiles.body.some((tf) => tf.name === 'My Own Memo')).toBe(false);
  });
});
