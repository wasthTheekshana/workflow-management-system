const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
const ADMIN_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('document types admin API', () => {
  let templateFileId;
  let workflowTemplateId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Document Types Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'dt-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
    const [templateFile] = await db('template_files').insert({ tenant_id: TENANT_ID, name: 'HR Letter' }).returning('id');
    templateFileId = templateFile.id;
    const [workflowTemplate] = await db('workflow_templates')
      .insert({ tenant_id: TENANT_ID, name: 'HR Approval' })
      .returning('id');
    workflowTemplateId = workflowTemplate.id;
  });

  afterAll(async () => {
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('creates, lists, fetches, updates, and deletes a document type', async () => {
    const createResponse = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HR Letter', templateFileId, workflowTemplateId });
    expect(createResponse.status).toBe(201);
    const documentTypeId = createResponse.body.id;
    expect(createResponse.body.allowed_extensions).toEqual(['docx']);

    const listResponse = await request(app)
      .get('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.body.some((d) => d.id === documentTypeId)).toBe(true);

    const getResponse = await request(app)
      .get(`/admin/document-types/${documentTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.status).toBe(200);

    const updateResponse = await request(app)
      .patch(`/admin/document-types/${documentTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HR Letter (Updated)' });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.name).toBe('HR Letter (Updated)');

    const deleteResponse = await request(app)
      .delete(`/admin/document-types/${documentTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await request(app)
      .get(`/admin/document-types/${documentTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterDelete.status).toBe(404);
  });

  it('rejects a templateFileId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Cross Tenant',
        templateFileId: '00000000-0000-0000-0000-000000000099',
        workflowTemplateId,
      });
    expect(response.status).toBe(400);
  });
});
