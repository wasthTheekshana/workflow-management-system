const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c2000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c2000000-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'c2000000-0000-0000-0000-000000000003';
const OUTSIDER_ID = 'c2000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const assigneeToken = signToken({ sub: ASSIGNEE_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const templateBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('template-v1')]);
const editedBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('edited-by-assignee')]);

function binaryParser(res, callback) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
}

describe('instance save-version cycle', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Versions Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ver-admin@example.com', password_hash: 'x', is_admin: true },
        { id: ASSIGNEE_ID, tenant_id: TENANT_ID, email: 'ver-assignee@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'ver-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Versioned Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', templateBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Versioned Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ASSIGNEE_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Versioned Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;
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
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('serves the snapshotted template before any instance version exists', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/current-file`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .buffer(true)
      .parse(binaryParser);
    expect(response.status).toBe(200);
    expect(response.body.toString()).toContain('template-v1');
  });

  it('rejects an upload from someone who is not the stage assignee', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .attach('file', editedBuffer, 'edited.docx');
    expect(response.status).toBe(403);
  });

  it('accepts an upload from the assignee and serves it as the current file', async () => {
    const uploadResponse = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .attach('file', editedBuffer, 'edited.docx');
    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.version_number).toBe(1);

    const currentFile = await request(app)
      .get(`/instances/${instanceId}/current-file`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .buffer(true)
      .parse(binaryParser);
    expect(currentFile.status).toBe(200);
    expect(currentFile.body.toString()).toContain('edited-by-assignee');
  });

  it('rejects an upload whose content does not match the docx signature, even with a .docx name', async () => {
    const fakeBuffer = Buffer.from('this is plainly not an office document');
    const response = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .attach('file', fakeBuffer, 'disguised.docx');
    expect(response.status).toBe(400);
  });

  it("rejects an upload exceeding the document type's configured max size", async () => {
    const oversizedBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(11 * 1024 * 1024),
    ]);
    const response = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .attach('file', oversizedBuffer, 'huge.docx');
    expect(response.status).toBe(400);
  });
});
