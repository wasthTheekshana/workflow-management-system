const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_A = 'f0000000-0000-0000-0000-00000000000a';
const TENANT_B = 'f0000000-0000-0000-0000-00000000000b';
const ADMIN_A = 'f0000000-0000-0000-0000-00000000001a';
const USER_A = 'f0000000-0000-0000-0000-00000000002a';
const ADMIN_B = 'f0000000-0000-0000-0000-00000000001b';
const USER_B = 'f0000000-0000-0000-0000-00000000002b';
const adminTokenA = signToken({ sub: ADMIN_A, tenant_id: TENANT_A, is_admin: true });
const userTokenA = signToken({ sub: USER_A, tenant_id: TENANT_A, is_admin: false });
const adminTokenB = signToken({ sub: ADMIN_B, tenant_id: TENANT_B, is_admin: true });
const userTokenB = signToken({ sub: USER_B, tenant_id: TENANT_B, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

async function setupTenant(tenantId, adminId, adminToken, userId, userEmail, userToken) {
  await db('tenants').insert({ id: tenantId, name: `Tenant ${tenantId}` }).onConflict('id').ignore();
  await db('users')
    .insert([
      { id: adminId, tenant_id: tenantId, email: `${adminId}@example.com`, password_hash: 'x', is_admin: true },
      { id: userId, tenant_id: tenantId, email: userEmail, password_hash: 'x' },
    ])
    .onConflict('id')
    .ignore();

  const templateFile = await request(app)
    .post('/admin/template-files')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Isolation Template' });
  await request(app)
    .post(`/admin/template-files/${templateFile.body.id}/versions`)
    .set('Authorization', `Bearer ${adminToken}`)
    .attach('file', validDocxBuffer, 'v1.docx');

  const workflowTemplate = await request(app)
    .post('/admin/workflow-templates')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Isolation Approval' });
  await request(app)
    .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: userId });

  const documentType = await request(app)
    .post('/admin/document-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Isolation Doc',
      templateFileId: templateFile.body.id,
      workflowTemplateId: workflowTemplate.body.id,
    });

  const instance = await request(app)
    .post('/instances')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ documentTypeId: documentType.body.id });

  return {
    templateFile: templateFile.body,
    workflowTemplate: workflowTemplate.body,
    documentType: documentType.body,
    instance: instance.body,
  };
}

describe('tenant isolation sweep', () => {
  let tenantAData;
  let tenantBData;

  beforeAll(async () => {
    tenantAData = await setupTenant(TENANT_A, ADMIN_A, adminTokenA, USER_A, 'iso-user-a@example.com', userTokenA);
    tenantBData = await setupTenant(TENANT_B, ADMIN_B, adminTokenB, USER_B, 'iso-user-b@example.com', userTokenB);
  });

  afterAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await db('notifications').where({ tenant_id: tenantId }).del();
      await db('stage_actions').where({ tenant_id: tenantId }).del();
      await db('instance_versions').where({ tenant_id: tenantId }).del();
      await db('workflow_instances').where({ tenant_id: tenantId }).del();
      await db('document_types').where({ tenant_id: tenantId }).del();
      await db('workflow_stages').where({ tenant_id: tenantId }).del();
      await db('workflow_templates').where({ tenant_id: tenantId }).del();
      await db('template_file_versions').where({ tenant_id: tenantId }).del();
      await db('template_files').where({ tenant_id: tenantId }).del();
      await db('users').where({ tenant_id: tenantId }).del();
      await db('tenants').where({ id: tenantId }).del();
    }
    await db.destroy();
  });

  it("rejects reading tenant B's template file with tenant A's admin token", async () => {
    const response = await request(app)
      .get(`/admin/template-files/${tenantBData.templateFile.id}`)
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(response.status).toBe(404);
  });

  it("rejects uploading a version to tenant B's template file as tenant A", async () => {
    const response = await request(app)
      .post(`/admin/template-files/${tenantBData.templateFile.id}/versions`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .attach('file', validDocxBuffer, 'v2.docx');
    expect(response.status).toBe(404);
  });

  it("rejects reading tenant B's workflow template with tenant A's admin token", async () => {
    const response = await request(app)
      .get(`/admin/workflow-templates/${tenantBData.workflowTemplate.id}`)
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(response.status).toBe(404);
  });

  it("rejects adding a stage to tenant B's workflow template as tenant A", async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${tenantBData.workflowTemplate.id}/stages`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ stageOrder: 2, name: 'Cross-tenant stage', assigneeType: 'user', assigneeUserId: USER_A });
    expect(response.status).toBe(404);
  });

  it("rejects reading, updating, and deleting tenant B's document type as tenant A", async () => {
    const getResponse = await request(app)
      .get(`/admin/document-types/${tenantBData.documentType.id}`)
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(getResponse.status).toBe(404);

    const patchResponse = await request(app)
      .patch(`/admin/document-types/${tenantBData.documentType.id}`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ name: 'Hijacked' });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await request(app)
      .delete(`/admin/document-types/${tenantBData.documentType.id}`)
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(deleteResponse.status).toBe(404);
  });

  it("rejects starting an instance against tenant B's document type as tenant A", async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({ documentTypeId: tenantBData.documentType.id });
    expect(response.status).toBe(400);
  });

  it("rejects every instance action against tenant B's instance as tenant A", async () => {
    const instanceId = tenantBData.instance.id;

    const get = await request(app).get(`/instances/${instanceId}`).set('Authorization', `Bearer ${userTokenA}`);
    expect(get.status).toBe(404);

    const claim = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${userTokenA}`);
    expect(claim.status).toBe(404);

    const upload = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${userTokenA}`)
      .attach('file', validDocxBuffer, 'x.docx');
    expect(upload.status).toBe(404);

    const download = await request(app)
      .get(`/instances/${instanceId}/current-file`)
      .set('Authorization', `Bearer ${userTokenA}`);
    expect(download.status).toBe(404);

    const forward = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({});
    expect(forward.status).toBe(404);

    const sendBack = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({});
    expect(sendBack.status).toBe(404);

    const reject = await request(app)
      .post(`/instances/${instanceId}/reject`)
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({});
    expect(reject.status).toBe(404);

    const resubmit = await request(app)
      .post(`/instances/${instanceId}/resubmit`)
      .set('Authorization', `Bearer ${userTokenA}`);
    expect(resubmit.status).toBe(404);

    const history = await request(app)
      .get(`/instances/${instanceId}/history`)
      .set('Authorization', `Bearer ${userTokenA}`);
    expect(history.status).toBe(404);
  });

  it("rejects admin reassignment of tenant B's instance as tenant A's admin", async () => {
    const response = await request(app)
      .post(`/admin/instances/${tenantBData.instance.id}/reassign`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ userId: USER_A });
    expect(response.status).toBe(404);
  });

  it("never includes tenant B's data in tenant A's list endpoints", async () => {
    const templateFiles = await request(app)
      .get('/admin/template-files')
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(templateFiles.body.map((t) => t.id)).not.toContain(tenantBData.templateFile.id);

    const workflowTemplates = await request(app)
      .get('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(workflowTemplates.body.map((w) => w.id)).not.toContain(tenantBData.workflowTemplate.id);

    const documentTypes = await request(app)
      .get('/admin/document-types')
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(documentTypes.body.map((d) => d.id)).not.toContain(tenantBData.documentType.id);

    const adminInstances = await request(app)
      .get('/admin/instances')
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(adminInstances.body.map((i) => i.id)).not.toContain(tenantBData.instance.id);

    const myTasks = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${userTokenA}`);
    const allMyTasksIds = [
      ...myTasks.body.assignedToMe,
      ...myTasks.body.waitingOnOthers,
      ...myTasks.body.completed,
    ].map((i) => i.id);
    expect(allMyTasksIds).not.toContain(tenantBData.instance.id);
  });
});
