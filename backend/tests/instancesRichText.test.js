const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'a0000000-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'a0000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const assigneeToken = signToken({ sub: ASSIGNEE_ID, tenant_id: TENANT_ID, is_admin: false });
const initialContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template' }] }] };
const editedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited' }] }] };

describe('rich-text instances', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'RichText Instance Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'rti-admin@example.com', password_hash: 'x', is_admin: true },
        { id: ASSIGNEE_ID, tenant_id: TENANT_ID, email: 'rti-assignee@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Instance Template', contentFormat: 'richtext' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/content-versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: initialContent });

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ASSIGNEE_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'RichText Doc',
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

  it('reports contentFormat on the instance detail response', async () => {
    const response = await request(app).get(`/instances/${instanceId}`).set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.body.contentFormat).toBe('richtext');
  });

  it('falls back to the template snapshot content before any instance version exists', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/current-content`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.status).toBe(200);
    expect(response.body.content).toEqual(initialContent);
  });

  it('rejects a file upload on a richtext instance', async () => {
    const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
    const response = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');
    expect(response.status).toBe(400);
  });

  it('rejects Edit Online (OnlyOffice) on a richtext instance', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/edit-config`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.status).toBe(400);
  });

  it('saves a content version and serves it as the current content', async () => {
    const saveResponse = await request(app)
      .post(`/instances/${instanceId}/content-versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ content: editedContent });
    expect(saveResponse.status).toBe(201);
    expect(saveResponse.body.version_number).toBe(1);

    const currentResponse = await request(app)
      .get(`/instances/${instanceId}/current-content`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(currentResponse.body.content).toEqual(editedContent);
  });
});
