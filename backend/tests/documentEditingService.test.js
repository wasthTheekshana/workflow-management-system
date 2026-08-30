const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');
const { validateEnv } = require('../src/config/env');

const TENANT_ID = 'ad000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ad000000-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'ad000000-0000-0000-0000-000000000003';
const OUTSIDER_ID = 'ad000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const assigneeToken = signToken({ sub: ASSIGNEE_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('edit-config endpoints', () => {
  let templateFileId;
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Editing Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'edit-admin@example.com', password_hash: 'x', is_admin: true },
        { id: ASSIGNEE_ID, tenant_id: TENANT_ID, email: 'edit-assignee@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'edit-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Editable Template' });
    templateFileId = templateFile.body.id;
    await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Editable Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ASSIGNEE_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Editable Doc', templateFileId, workflowTemplateId: workflowTemplate.body.id });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;
  });

  afterAll(async () => {
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

  it('builds a signed, edit-mode config for an admin editing a template file', async () => {
    const response = await request(app)
      .get(`/admin/template-files/${templateFileId}/edit-config`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.editorConfig.mode).toBe('edit');
    expect(response.body.document.fileType).toBe('docx');
    expect(response.body.document.key).toContain(templateFileId);

    const config = validateEnv();
    const decoded = jwt.verify(response.body.token, config.onlyoffice.jwtSecret, { algorithms: ['HS256'] });
    expect(decoded.document.key).toBe(response.body.document.key);
  });

  it('builds an edit-mode config for the stage assignee on their own instance', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/edit-config`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.status).toBe(200);
    expect(response.body.editorConfig.mode).toBe('edit');
  });

  it('builds a view-only config for a tenant member who cannot act on the instance', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/edit-config`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(response.status).toBe(200);
    expect(response.body.editorConfig.mode).toBe('view');
  });
});
