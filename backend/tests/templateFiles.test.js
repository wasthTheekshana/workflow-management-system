const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('template files admin API', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Template Files Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'tf-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ id: ADMIN_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app).post('/admin/template-files').send({ name: 'SRS Template' });
    expect(response.status).toBe(401);
  });

  it('creates a template file, uploads two versions, and lists them', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SRS Template' });
    expect(createResponse.status).toBe(201);
    const templateFileId = createResponse.body.id;

    const firstUpload = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'srs-v1.docx');
    expect(firstUpload.status).toBe(201);
    expect(firstUpload.body.version_number).toBe(1);

    const secondUpload = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'srs-v2.docx');
    expect(secondUpload.status).toBe(201);
    expect(secondUpload.body.version_number).toBe(2);

    const detailResponse = await request(app)
      .get(`/admin/template-files/${templateFileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.versions).toHaveLength(2);

    const listResponse = await request(app)
      .get('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((t) => t.id === templateFileId)).toBe(true);
  });

  it('rejects an upload with a disallowed extension', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad Extension Template' });
    const templateFileId = createResponse.body.id;

    const response = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'malicious.exe');
    expect(response.status).toBe(400);
  });

  it('returns 404 for a template file that does not belong to the caller', async () => {
    const response = await request(app)
      .get('/admin/template-files/99999999-9999-9999-9999-999999999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });
});
