const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c2100000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c2100000-0000-0000-0000-000000000002';
const USER1_ID = 'c2100000-0000-0000-0000-000000000003';
const USER2_ID = 'c2100000-0000-0000-0000-000000000004';

const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const user1Token = signToken({ sub: USER1_ID, tenant_id: TENANT_ID, is_admin: false });
const user2Token = signToken({ sub: USER2_ID, tenant_id: TENANT_ID, is_admin: false });

const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
const samplePdfBuffer = Buffer.from('%PDF-1.4 sample pdf content for attachment testing');

describe('multi-file supporting attachments', () => {
  let documentTypeId;
  let templateFileId;
  let workflowTemplateId;
  let testInstanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Attachment Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'attach-admin@example.com', full_name: 'Admin User', password_hash: 'x', is_admin: true },
        { id: USER1_ID, tenant_id: TENANT_ID, email: 'attach-user1@example.com', full_name: 'Regular User 1', password_hash: 'x' },
        { id: USER2_ID, tenant_id: TENANT_ID, email: 'attach-user2@example.com', full_name: 'Regular User 2', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Attachment Template' });
    templateFileId = templateFile.body.id;

    await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Attachment Workflow' });
    workflowTemplateId = workflowTemplate.body.id;

    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Initial Review', assigneeType: 'user', assigneeUserId: USER1_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Attachment Doc Type',
        templateFileId,
        workflowTemplateId,
      });
    documentTypeId = documentType.body.id;

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ documentTypeId });
    testInstanceId = started.body.id;
  });

  afterAll(async () => {
    await db('instance_attachments').where({ tenant_id: TENANT_ID }).del();
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('instance_versions').where({ tenant_id: TENANT_ID }).del();
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

  it('lists empty attachments initially', async () => {
    const res = await request(app)
      .get(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('rejects disallowed file extensions', async () => {
    const res = await request(app)
      .post(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`)
      .attach('file', Buffer.from('malicious script'), 'payload.exe');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('allows uploading a valid supporting attachment and logs audit trail', async () => {
    const res = await request(app)
      .post(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`)
      .attach('file', samplePdfBuffer, 'invoice_quote.pdf');

    expect(res.status).toBe(201);
    expect(res.body.file_name).toBe('invoice_quote.pdf');
    expect(res.body.file_size_bytes).toBe(samplePdfBuffer.length);
    expect(res.body.uploaded_by).toBe(USER1_ID);

    // Verify list attachments now contains this file
    const listRes = await request(app)
      .get(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].file_name).toBe('invoice_quote.pdf');
    expect(listRes.body[0].uploader_name).toBe('Regular User 1');
    expect(listRes.body[0].uploader_email).toBe('attach-user1@example.com');

    // Verify stage_actions audit trail has add_attachment
    const actions = await db('stage_actions')
      .where({ tenant_id: TENANT_ID, workflow_instance_id: testInstanceId, action_type: 'add_attachment' });
    expect(actions).toHaveLength(1);
    expect(actions[0].comment).toBe('invoice_quote.pdf');
    expect(actions[0].actor_id).toBe(USER1_ID);
  });

  it('downloads an attachment correctly', async () => {
    const listRes = await request(app)
      .get(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`);
    const attachmentId = listRes.body[0].id;

    const res = await request(app)
      .get(`/instances/${testInstanceId}/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(res.status).toBe(200);
    expect(res.header['content-disposition']).toMatch(/invoice_quote\.pdf/);
    expect(res.body).toEqual(samplePdfBuffer);
  });

  it('prevents non-uploader non-admin user from deleting attachment', async () => {
    const listRes = await request(app)
      .get(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`);
    const attachmentId = listRes.body[0].id;

    const res = await request(app)
      .delete(`/instances/${testInstanceId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the uploader or an admin/i);
  });

  it('allows the uploader to delete their attachment and logs audit trail', async () => {
    const listRes = await request(app)
      .get(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`);
    const attachmentId = listRes.body[0].id;

    const res = await request(app)
      .delete(`/instances/${testInstanceId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.status).toBe(204);

    // List should now be empty
    const listAfter = await request(app)
      .get(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`);
    expect(listAfter.body).toHaveLength(0);

    // Audit trail has delete_attachment
    const actions = await db('stage_actions')
      .where({ tenant_id: TENANT_ID, workflow_instance_id: testInstanceId, action_type: 'delete_attachment' });
    expect(actions).toHaveLength(1);
    expect(actions[0].comment).toBe('invoice_quote.pdf');
    expect(actions[0].actor_id).toBe(USER1_ID);
  });

  it('allows admin to delete an attachment uploaded by another user', async () => {
    // Re-upload by user1
    const uploadRes = await request(app)
      .post(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`)
      .attach('file', samplePdfBuffer, 'receipt.pdf');
    const attachmentId = uploadRes.body.id;

    // Admin deletes
    const res = await request(app)
      .delete(`/instances/${testInstanceId}/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);
  });

  it('blocks uploading attachments on cancelled or completed instances', async () => {
    // Cancel the instance
    await request(app)
      .post(`/instances/${testInstanceId}/cancel`)
      .set('Authorization', `Bearer ${user1Token}`);

    const res = await request(app)
      .post(`/instances/${testInstanceId}/attachments`)
      .set('Authorization', `Bearer ${user1Token}`)
      .attach('file', samplePdfBuffer, 'after_cancel.pdf');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only in-progress instances accept new attachments/i);
  });
});

