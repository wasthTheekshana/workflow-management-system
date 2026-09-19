const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_A = 'fa000000-0000-0000-0000-000000000001';
const ADMIN_A = 'fa000000-0000-0000-0000-000000000002';
const USER_A = 'fa000000-0000-0000-0000-000000000003';

const TENANT_B = 'fb000000-0000-0000-0000-000000000001';
const ADMIN_B = 'fb000000-0000-0000-0000-000000000002';

const adminTokenA = signToken({ sub: ADMIN_A, tenant_id: TENANT_A, is_admin: true });
const userTokenA = signToken({ sub: USER_A, tenant_id: TENANT_A, is_admin: false });
const adminTokenB = signToken({ sub: ADMIN_B, tenant_id: TENANT_B, is_admin: true });

const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('Operational Bottleneck & Cycle Time Analytics (GET /admin/analytics)', () => {
  let templateId;
  let documentTypeId;
  let stage1Id;
  let stage2Id;

  beforeAll(async () => {
    // Setup tenants
    await db('tenants').insert([
      { id: TENANT_A, name: 'Analytics Tenant A' },
      { id: TENANT_B, name: 'Analytics Tenant B' },
    ]).onConflict('id').ignore();

    // Setup users
    await db('users').insert([
      { id: ADMIN_A, tenant_id: TENANT_A, email: 'admin-a@example.com', password_hash: 'x', is_admin: true },
      { id: USER_A, tenant_id: TENANT_A, email: 'user-a@example.com', password_hash: 'x', is_admin: false },
      { id: ADMIN_B, tenant_id: TENANT_B, email: 'admin-b@example.com', password_hash: 'x', is_admin: true },
    ]).onConflict('id').ignore();

    // Create template file
    const tf = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ name: 'Analytics Form' });

    await request(app)
      .post(`/admin/template-files/${tf.body.id}/versions`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    // Create workflow template with SLA on stages
    const wt = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ name: 'Procurement Workflow' });
    templateId = wt.body.id;

    // Stage 1 with 24h SLA
    const s1 = await request(app)
      .post(`/admin/workflow-templates/${templateId}/stages`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        stageOrder: 1,
        name: 'Initiation',
        assigneeType: 'user',
        assigneeUserId: USER_A,
        slaHours: 24,
      });
    stage1Id = s1.body.id;

    // Stage 2 with 48h SLA
    const s2 = await request(app)
      .post(`/admin/workflow-templates/${templateId}/stages`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        stageOrder: 2,
        name: 'Finance Approval',
        assigneeType: 'user',
        assigneeUserId: ADMIN_A,
        slaHours: 48,
      });
    stage2Id = s2.body.id;

    // Create document type
    const dt = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        name: 'Purchase Order',
        templateFileId: tf.body.id,
        workflowTemplateId: templateId,
      });
    documentTypeId = dt.body.id;

    // Instance 1: Started, Forwarded to Stage 2, Completed
    const i1 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({ documentTypeId });

    await request(app)
      .post(`/instances/${i1.body.id}/forward`)
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({ comment: 'Proceed to Finance' });

    await request(app)
      .post(`/instances/${i1.body.id}/forward`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ comment: 'Approved & Completed' });

    // Instance 2: Started, then Rejected at Stage 1
    const i2 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({ documentTypeId });

    await request(app)
      .post(`/instances/${i2.body.id}/reject`)
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({ comment: 'Incomplete specs' });

    // Instance 3: In-Progress at Stage 1, artificially set past due to simulate bottleneck
    const i3 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({ documentTypeId });

    const pastDate = new Date(Date.now() - 36 * 60 * 60 * 1000); // 36 hours ago
    await db('workflow_instances')
      .where({ tenant_id: TENANT_A, id: i3.body.id })
      .update({
        stage_entered_at: pastDate,
        stage_due_at: new Date(Date.now() - 12 * 60 * 60 * 1000), // Overdue by 12 hours
      });
  });

  it('rejects access from non-admin users with 403', async () => {
    const res = await request(app)
      .get('/admin/analytics')
      .set('Authorization', `Bearer ${userTokenA}`);
    expect(res.status).toBe(403);
  });

  it('returns comprehensive executive KPIs for the tenant', async () => {
    const res = await request(app)
      .get('/admin/analytics')
      .set('Authorization', `Bearer ${adminTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('kpis');
    expect(res.body).toHaveProperty('stageMetrics');
    expect(res.body).toHaveProperty('templateMetrics');

    const { kpis } = res.body;
    expect(kpis.totalInstances).toBe(3);
    expect(kpis.completedInstances).toBe(1);
    expect(kpis.rejectedInstances).toBe(1);
    expect(kpis.inProgressInstances).toBe(1);
    expect(kpis.activeOverdueCount).toBe(1);
    expect(kpis.overdueRate).toBe(100); // 1 active out of 1 is overdue
    expect(kpis.completionRate).toBe(50); // 1 completed out of 2 resolved
    expect(typeof kpis.avgCycleTimeHours).toBe('number');
  });

  it('calculates stage turnaround times, queues, and bottleneck health status', async () => {
    const res = await request(app)
      .get('/admin/analytics')
      .set('Authorization', `Bearer ${adminTokenA}`);

    expect(res.status).toBe(200);
    const { stageMetrics } = res.body;

    expect(stageMetrics.length).toBe(2);

    const stage1 = stageMetrics.find((s) => s.stageOrder === 1);
    const stage2 = stageMetrics.find((s) => s.stageOrder === 2);

    expect(stage1).toBeDefined();
    expect(stage1.stageName).toBe('Initiation');
    expect(stage1.slaHours).toBe(24);
    expect(stage1.activeQueueCount).toBe(1); // Instance 3 is pending here
    expect(stage1.activeOverdueCount).toBe(1); // Instance 3 is overdue
    expect(stage1.healthStatus).toBe('bottleneck'); // Because activeOverdueCount > 0
    expect(stage1.completedTransitionsCount).toBeGreaterThanOrEqual(2); // i1 forward + i2 reject

    expect(stage2).toBeDefined();
    expect(stage2.stageName).toBe('Finance Approval');
    expect(stage2.slaHours).toBe(48);
    expect(stage2.activeQueueCount).toBe(0);
    expect(stage2.activeOverdueCount).toBe(0);
    expect(stage2.healthStatus).toBe('healthy');
  });

  it('provides workflow template level cycle times and breakdown', async () => {
    const res = await request(app)
      .get('/admin/analytics')
      .set('Authorization', `Bearer ${adminTokenA}`);

    expect(res.status).toBe(200);
    const { templateMetrics } = res.body;

    expect(templateMetrics.length).toBe(1);
    const tmpl = templateMetrics[0];
    expect(tmpl.id).toBe(templateId);
    expect(tmpl.name).toBe('Procurement Workflow');
    expect(tmpl.totalInstances).toBe(3);
    expect(tmpl.completedCount).toBe(1);
    expect(tmpl.rejectedCount).toBe(1);
    expect(tmpl.inProgressCount).toBe(1);
    expect(tmpl.activeOverdueCount).toBe(1);
  });

  it('filters analytics when workflowTemplateId is specified', async () => {
    const res = await request(app)
      .get(`/admin/analytics?workflowTemplateId=${templateId}`)
      .set('Authorization', `Bearer ${adminTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.kpis.totalInstances).toBe(3);
  });

  it('maintains strict tenant isolation (Tenant B sees zero instances)', async () => {
    const res = await request(app)
      .get('/admin/analytics')
      .set('Authorization', `Bearer ${adminTokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.kpis.totalInstances).toBe(0);
    expect(res.body.kpis.completedInstances).toBe(0);
    expect(res.body.kpis.activeOverdueCount).toBe(0);
    expect(res.body.stageMetrics.length).toBe(0);
    expect(res.body.templateMetrics.length).toBe(0);
  });

  afterAll(async () => {
    await db('stage_actions').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('workflow_instances').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('document_types').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('workflow_stages').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('workflow_templates').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('template_file_versions').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('template_files').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('users').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('tenants').whereIn('id', [TENANT_A, TENANT_B]).del();
  });
});

