const http = require('http');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');
const { validateEnv } = require('../src/config/env');

const TENANT_ID = 'ae000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ae000000-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'ae000000-0000-0000-0000-000000000003';
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
const savedDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('saved-by-editor')]);

function signOnlyOfficeJwt(payload) {
  const config = validateEnv();
  return jwt.sign(payload, config.onlyoffice.jwtSecret, { algorithm: 'HS256' });
}

async function startFixtureServer(buffer) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end(buffer);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/saved.docx` });
    });
  });
}

describe('POST /files/callback', () => {
  let templateFileId;
  let instanceId;
  let fixtureServer;
  let fixtureUrl;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Callback Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'cb-admin@example.com', password_hash: 'x', is_admin: true },
        { id: ASSIGNEE_ID, tenant_id: TENANT_ID, email: 'cb-assignee@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
    const assigneeToken = signToken({ sub: ASSIGNEE_ID, tenant_id: TENANT_ID, is_admin: false });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Callback Template' });
    templateFileId = templateFile.body.id;
    await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Callback Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ASSIGNEE_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Callback Doc', templateFileId, workflowTemplateId: workflowTemplate.body.id });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;
  });

  beforeEach(async () => {
    ({ server: fixtureServer, url: fixtureUrl } = await startFixtureServer(savedDocxBuffer));
  });

  afterEach(async () => {
    await new Promise((resolve) => fixtureServer.close(resolve));
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

  it('rejects a callback with no valid OnlyOffice token', async () => {
    const response = await request(app)
      .post(`/files/callback/template-files/${templateFileId}?tenantId=${TENANT_ID}&actorUserId=${ADMIN_ID}`)
      .send({ status: 2, url: fixtureUrl });
    expect(response.status).toBe(403);
  });

  it('creates a new template file version on a valid save callback', async () => {
    const token = signOnlyOfficeJwt({ status: 2, url: fixtureUrl });
    const response = await request(app)
      .post(`/files/callback/template-files/${templateFileId}?tenantId=${TENANT_ID}&actorUserId=${ADMIN_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 2, url: fixtureUrl });

    expect(response.status).toBe(200);
    expect(response.body.error).toBe(0);

    const versions = await db('template_file_versions').where({ tenant_id: TENANT_ID, template_file_id: templateFileId });
    expect(versions).toHaveLength(2);
    expect(versions.some((v) => v.uploaded_by === ADMIN_ID && v.version_number === 2)).toBe(true);
  });

  it('creates a new instance version on a valid save callback', async () => {
    const token = signOnlyOfficeJwt({ status: 2, url: fixtureUrl });
    const response = await request(app)
      .post(`/files/callback/instances/${instanceId}?tenantId=${TENANT_ID}&actorUserId=${ASSIGNEE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 2, url: fixtureUrl });

    expect(response.status).toBe(200);
    expect(response.body.error).toBe(0);

    const versions = await db('instance_versions').where({ tenant_id: TENANT_ID, workflow_instance_id: instanceId });
    expect(versions).toHaveLength(1);
    expect(versions[0].uploaded_by).toBe(ASSIGNEE_ID);
  });

  it('does nothing for a non-save status (e.g. still editing)', async () => {
    const token = signOnlyOfficeJwt({ status: 1 });
    const response = await request(app)
      .post(`/files/callback/instances/${instanceId}?tenantId=${TENANT_ID}&actorUserId=${ASSIGNEE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 1 });

    expect(response.status).toBe(200);
    expect(response.body.error).toBe(0);

    const versions = await db('instance_versions').where({ tenant_id: TENANT_ID, workflow_instance_id: instanceId });
    expect(versions).toHaveLength(1); // unchanged from the previous test
  });
});
