const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c5000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c5000000-0000-0000-0000-000000000002';
const STAGE1_USER = 'c5000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const stage1Token = signToken({ sub: STAGE1_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
const editedBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('final-draft-before-rejection')]);

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

describe('hard reject and clone-after-reject resubmission', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Reject Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'rej-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STAGE1_USER, tenant_id: TENANT_ID, email: 'rej-stage1@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reject Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reject Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: STAGE1_USER });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Reject Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;

    await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .attach('file', editedBuffer, 'final.docx');
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

  it('hard-rejects the instance', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/reject`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ comment: 'Wrong template entirely' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('rejected');
  });

  it('rejects further actions on a rejected instance', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});
    expect(response.status).toBe(400);
  });

  it('clones the rejected instance into a fresh one carrying the last saved version', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/resubmit`)
      .set('Authorization', `Bearer ${stage1Token}`);
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('in_progress');
    expect(response.body.current_stage_order).toBe(1);
    expect(response.body.id).not.toBe(instanceId);

    const currentFile = await request(app)
      .get(`/instances/${response.body.id}/current-file`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .buffer(true)
      .parse(binaryParser);
    expect(currentFile.status).toBe(200);
    expect(currentFile.body.toString()).toContain('final-draft-before-rejection');
  });
});
