const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'f2000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'f2000000-0000-0000-0000-000000000002';
const USER_ID = 'f2000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const ROW_COUNT = 8000;

async function explainPlanText(query, bindings) {
  const result = await db.raw(`EXPLAIN ${query}`, bindings);
  return result.rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('index effectiveness under realistic volume', () => {
  let documentTypeId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Index Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'idx-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();

    const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Index Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Index Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: USER_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Index Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;
    const templateFileVersionId = (
      await db('template_file_versions').where({ tenant_id: TENANT_ID }).first()
    ).id;

    // Bulk-seed workflow_instances: mostly 'completed'/'rejected' so
    // 'in_progress' is a selective minority — matching a real tenant
    // dashboard's data shape.
    await db.raw(
      `
      INSERT INTO workflow_instances
        (tenant_id, document_type_id, template_file_version_id, current_stage_order, status, created_by, created_at, updated_at)
      SELECT ?, ?, ?, 1,
        (ARRAY['completed', 'rejected', 'completed', 'rejected', 'in_progress'])[1 + (s % 5)],
        ?, now(), now()
      FROM generate_series(1, ?) s
      `,
      [TENANT_ID, documentTypeId, templateFileVersionId, ADMIN_ID, ROW_COUNT],
    );
    await db.raw('ANALYZE workflow_instances');

    // Bulk-seed notifications: mostly 'sent' with a selective 'pending'
    // minority, matching the worker's real poll query shape.
    await db.raw(
      `
      INSERT INTO notifications (tenant_id, recipient_email, subject, body, status, created_at, updated_at)
      SELECT ?, 'load-test@example.com', 'Load test', 'Load test body',
        CASE WHEN s % 20 = 0 THEN 'pending' ELSE 'sent' END,
        now(), now()
      FROM generate_series(1, ?) s
      `,
      [TENANT_ID, ROW_COUNT],
    );
    await db.raw('ANALYZE notifications');
  });

  afterAll(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  }, 30000);

  it('uses an index (not a full table scan) for the tenant dashboard query', async () => {
    const plan = await explainPlanText(
      `SELECT * FROM workflow_instances WHERE tenant_id = ? AND status = ?`,
      [TENANT_ID, 'in_progress'],
    );
    expect(plan).not.toContain('Seq Scan');
  });

  it("uses an index (not a full table scan) for the notification worker's poll query", async () => {
    const plan = await explainPlanText(`SELECT * FROM notifications WHERE status = ?`, ['pending']);
    expect(plan).not.toContain('Seq Scan');
  });
});
