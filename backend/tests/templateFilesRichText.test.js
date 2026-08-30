const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'af000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'af000000-0000-0000-0000-000000000002';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const sampleContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };

describe('rich-text template files', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'RichText Template Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'rt-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('creates a richtext template and saves content versions', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Template', contentFormat: 'richtext' });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.content_format).toBe('richtext');
    const templateFileId = createResponse.body.id;

    const versionResponse = await request(app)
      .post(`/admin/template-files/${templateFileId}/content-versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: sampleContent });
    expect(versionResponse.status).toBe(201);
    expect(versionResponse.body.version_number).toBe(1);
    expect(versionResponse.body.content).toEqual(sampleContent);

    const detailResponse = await request(app)
      .get(`/admin/template-files/${templateFileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.body.versions).toHaveLength(1);
    expect(detailResponse.body.versions[0].file_path).toBeNull();
  });

  it('rejects a file upload on a richtext template', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Template 2', contentFormat: 'richtext' });
    const templateFileId = createResponse.body.id;

    const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
    const response = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');
    expect(response.status).toBe(400);
  });

  it('rejects a content-version on a docx template', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Docx Template' });
    expect(createResponse.body.content_format).toBe('docx');
    const templateFileId = createResponse.body.id;

    const response = await request(app)
      .post(`/admin/template-files/${templateFileId}/content-versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: sampleContent });
    expect(response.status).toBe(400);
  });

  it('rejects Edit Online (OnlyOffice) on a richtext template', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Template 3', contentFormat: 'richtext' });
    const templateFileId = createResponse.body.id;
    await request(app)
      .post(`/admin/template-files/${templateFileId}/content-versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: sampleContent });

    const response = await request(app)
      .get(`/admin/template-files/${templateFileId}/edit-config`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
  });
});
