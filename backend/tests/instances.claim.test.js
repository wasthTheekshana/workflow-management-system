const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c1000000-0000-0000-0000-000000000002';
const REVIEWER_ID = 'c1000000-0000-0000-0000-000000000003';
const OUTSIDER_ID = 'c1000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const reviewerToken = signToken({ sub: REVIEWER_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('claiming a role-assigned stage', () => {
  let documentTypeId;
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Claim Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'claim-admin@example.com', password_hash: 'x', is_admin: true },
        { id: REVIEWER_ID, tenant_id: TENANT_ID, email: 'claim-reviewer@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'claim-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [role] = await db('roles').insert({ tenant_id: TENANT_ID, name: 'Reviewer' }).returning('id');
    await db('user_roles').insert({ tenant_id: TENANT_ID, user_id: REVIEWER_ID, role_id: role.id });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HR Letter' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HR Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Review', assigneeType: 'role', assigneeRoleId: role.id });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'HR Letter',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ documentTypeId });
    instanceId = started.body.id;
  });

  afterAll(async () => {
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('user_roles').where({ tenant_id: TENANT_ID }).del();
    await db('roles').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects a claim from a user who does not hold the role', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(response.status).toBe(403);
  });

  it('lets a role-holder claim the instance, then rejects a second claim', async () => {
    const claimResponse = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.body.claimed_by).toBe(REVIEWER_ID);

    const secondClaim = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(secondClaim.status).toBe(400);
  });
});
