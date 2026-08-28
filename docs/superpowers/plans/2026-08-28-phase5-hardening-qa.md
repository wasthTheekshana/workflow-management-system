# Phase 5 — Hardening & QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the Section 6 security checklist against the *running* system, not just the code: upload validation actually rejects hostile input at every upload endpoint, tenant A genuinely cannot read or act on tenant B's data anywhere, the indexes the schema was built around actually get used at realistic volume, and rate limiting/parameterization hold up under adversarial input.

**Architecture:** No new application code — this phase is entirely verification. New test files exercise existing endpoints from the outside (via `supertest`, exactly like every other phase) plus two direct-SQL checks (`EXPLAIN`, bulk seeding) that a pure HTTP test can't express. Nothing here changes `src/`.

**Tech Stack:** No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`

## Global Constraints

- This phase adds tests, not features — a task that finds a real gap gets a fix commit before the phase completes, never a downgraded assertion to make a test pass. (Spec §9 Phase 5 exit criteria: "verified against the running system, not just the code")
- Tenant isolation checks assert the *absence* of another tenant's data, not just a particular status code — a 404 that happens to also leak a row in its body would still be a failure. (Spec §6 "Multi-tenant data isolation")
- Index-effectiveness checks use `EXPLAIN` against a realistically-sized synthetic dataset, seeded with a single bulk `INSERT ... SELECT generate_series(...)` (not one row at a time) so the check itself runs fast. Statistics are refreshed with `ANALYZE` before `EXPLAIN`, since a planner can't make a good choice against stale stats.

---

## Task 1: Upload validation hardening — close the gaps

**Files:**
- Modify: `backend/tests/templateFiles.test.js` (add an oversized-file case)
- Modify: `backend/tests/instances.versions.test.js` (add signature-mismatch and oversized-file cases)

**Interfaces:** none — test-only task, exercising existing `assertAllowedUpload` (Phase 1) through the real HTTP endpoints.

Prior phases already proved extension rejection works end-to-end (`templateFiles.test.js`: `.exe` rejected) and that a valid file round-trips correctly (`instances.versions.test.js`). What's still unverified at the HTTP layer: an oversized file, and a `.docx`-named file whose content doesn't match the ZIP signature — both real attack shapes (a renamed executable; a file that blows past the configured cap).

- [ ] **Step 1: Add an oversized-file test to `backend/tests/templateFiles.test.js`**

Add this test inside the existing `describe('template files admin API', ...)` block, after the "rejects an upload with a disallowed extension" test:

```js
  it('rejects an upload exceeding the 10MB template size cap', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Oversized Template' });
    const templateFileId = createResponse.body.id;

    const oversizedBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(11 * 1024 * 1024),
    ]);

    const response = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', oversizedBuffer, 'huge.docx');
    expect(response.status).toBe(400);
  });
```

- [ ] **Step 2: Run it to confirm it already passes (proving the existing cap works end-to-end)**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/templateFiles.test.js`
Expected: PASS, all 5 tests green (the new one included).

- [ ] **Step 3: Add signature-mismatch and oversized-file tests to `backend/tests/instances.versions.test.js`**

Add these two tests inside the existing `describe('instance save-version cycle', ...)` block, after "accepts an upload from the assignee and serves it as the current file":

```js
  it('rejects an upload whose content does not match the docx signature, even with a .docx name', async () => {
    const fakeBuffer = Buffer.from('this is plainly not an office document');
    const response = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .attach('file', fakeBuffer, 'disguised.docx');
    expect(response.status).toBe(400);
  });

  it('rejects an upload exceeding the document type\'s configured max size', async () => {
    const oversizedBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(11 * 1024 * 1024),
    ]);
    const response = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .attach('file', oversizedBuffer, 'huge.docx');
    expect(response.status).toBe(400);
  });
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx jest tests/instances.versions.test.js`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add tests/templateFiles.test.js tests/instances.versions.test.js
git commit -m "test: close upload-validation gaps (oversized files, signature mismatch)"
```

---

## Task 2: Tenant-isolation sweep across every endpoint

**Files:**
- Create: `backend/tests/tenantIsolation.test.js`

**Interfaces:** none — test-only task.

Every prior phase's tests operated within a single tenant. This task builds two fully independent tenants (A and B), then uses tenant A's tokens against every one of tenant B's resource IDs across every admin and instance endpoint, asserting each one is rejected (404/400, never 200 with real data) and that list endpoints never include a single row belonging to the other tenant.

- [ ] **Step 1: Write the test**

```js
// backend/tests/tenantIsolation.test.js
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

  it('rejects reading tenant B\'s template file with tenant A\'s admin token', async () => {
    const response = await request(app)
      .get(`/admin/template-files/${tenantBData.templateFile.id}`)
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(response.status).toBe(404);
  });

  it('rejects uploading a version to tenant B\'s template file as tenant A', async () => {
    const response = await request(app)
      .post(`/admin/template-files/${tenantBData.templateFile.id}/versions`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .attach('file', validDocxBuffer, 'v2.docx');
    expect(response.status).toBe(404);
  });

  it('rejects reading tenant B\'s workflow template with tenant A\'s admin token', async () => {
    const response = await request(app)
      .get(`/admin/workflow-templates/${tenantBData.workflowTemplate.id}`)
      .set('Authorization', `Bearer ${adminTokenA}`);
    expect(response.status).toBe(404);
  });

  it('rejects adding a stage to tenant B\'s workflow template as tenant A', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${tenantBData.workflowTemplate.id}/stages`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ stageOrder: 2, name: 'Cross-tenant stage', assigneeType: 'user', assigneeUserId: USER_A });
    expect(response.status).toBe(404);
  });

  it('rejects reading, updating, and deleting tenant B\'s document type as tenant A', async () => {
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

  it('rejects starting an instance against tenant B\'s document type as tenant A', async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userTokenA}`)
      .send({ documentTypeId: tenantBData.documentType.id });
    expect(response.status).toBe(400);
  });

  it('rejects every instance action against tenant B\'s instance as tenant A', async () => {
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

  it('rejects admin reassignment of tenant B\'s instance as tenant A\'s admin', async () => {
    const response = await request(app)
      .post(`/admin/instances/${tenantBData.instance.id}/reassign`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ userId: USER_A });
    expect(response.status).toBe(404);
  });

  it('never includes tenant B\'s data in tenant A\'s list endpoints', async () => {
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
```

- [ ] **Step 2: Run the test**

Run: `npx jest tests/tenantIsolation.test.js`
Expected: PASS, all 8 tests green — every cross-tenant access attempt is rejected, and no list endpoint leaks the other tenant's rows. If anything here fails, that is a real isolation bug: fix the underlying route/service (add the missing `tenant_id` scope) before proceeding — do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/tenantIsolation.test.js
git commit -m "test: add comprehensive tenant-isolation sweep across every endpoint"
```

---

## Task 3: Rate limiting and SQL-injection-shaped input

**Files:**
- Create: `backend/tests/securityHardening.test.js`

**Interfaces:** none — test-only task.

- [ ] **Step 1: Write the test**

```js
// backend/tests/securityHardening.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'f1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'f1000000-0000-0000-0000-000000000002';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('security hardening', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Security Hardening Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'sec-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rate-limits repeated login attempts', async () => {
    const attempts = [];
    for (let i = 0; i < 11; i += 1) {
      attempts.push(
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post('/auth/login')
          .send({ email: 'nobody@example.com', password: 'wrong-password' }),
      );
    }

    const statuses = attempts.map((r) => r.status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  }, 15000);

  it('safely stores and round-trips a SQL-injection-shaped string via parameterized queries', async () => {
    const maliciousName = "Robert'); DROP TABLE workflow_templates;--";

    const createResponse = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: maliciousName });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.name).toBe(maliciousName);

    const tableStillExists = await db.schema.hasTable('workflow_templates');
    expect(tableStillExists).toBe(true);

    const listResponse = await request(app)
      .get('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((w) => w.name === maliciousName)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx jest tests/securityHardening.test.js`
Expected: PASS, both tests green. (The rate-limit test takes a few seconds for 11 sequential requests — the 15s timeout accounts for that.)

- [ ] **Step 3: Commit**

```bash
git add tests/securityHardening.test.js
git commit -m "test: verify login rate limiting and SQL-injection-shaped input handling"
```

---

## Task 4: Index effectiveness under realistic volume

**Files:**
- Create: `backend/tests/indexEffectiveness.test.js`

**Interfaces:** none — test-only task.

Verifies the two indexes the spec calls out by name (§6.3: `workflow_instances(tenant_id, status)` for the tenant dashboard/"my tasks" queries, `notifications(status)` for the background worker's poll query) are actually chosen by the query planner once there's enough data for it to matter — not just present in the migration.

- [ ] **Step 1: Write the test**

```js
// backend/tests/indexEffectiveness.test.js
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

    // Bulk-seed workflow_instances: one real row plus thousands of synthetic
    // ones, mostly 'completed'/'rejected' so 'in_progress' is a selective
    // minority — matching a real tenant dashboard's data shape.
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

    // Bulk-seed notifications: mostly 'sent' with a selective 'pending' minority,
    // matching the worker's real poll query shape.
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
  });

  it('uses an index (not a full table scan) for the tenant dashboard query', async () => {
    const plan = await explainPlanText(
      `SELECT * FROM workflow_instances WHERE tenant_id = ? AND status = ?`,
      [TENANT_ID, 'in_progress'],
    );
    expect(plan).not.toContain('Seq Scan');
  });

  it('uses an index (not a full table scan) for the notification worker\'s poll query', async () => {
    const plan = await explainPlanText(`SELECT * FROM notifications WHERE status = ?`, ['pending']);
    expect(plan).not.toContain('Seq Scan');
  });
}, 60000);
```

- [ ] **Step 2: Run the test**

Run: `npx jest tests/indexEffectiveness.test.js`
Expected: PASS, both tests green. (The bulk seed of 16,000 total rows across two tables should complete in a few seconds via `generate_series` — if this test times out, increase the Jest timeout rather than shrinking `ROW_COUNT` below what makes the index genuinely cheaper than a scan.)

- [ ] **Step 3: Commit**

```bash
git add tests/indexEffectiveness.test.js
git commit -m "test: verify index effectiveness under realistic data volume"
```

---

## Task 5: Full security-checklist pass, realistic UAT walkthrough, and phase wrap-up

**Files:** none created — verification and documentation only.

- [ ] **Step 1: Run the full automated test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all suites pass (Phases 0-4's 87 tests + this phase's new tests).

- [ ] **Step 2: Walk the spec's §6 security checklist against the running system**

With the stack running (`docker compose up -d postgres`, `npm run migrate`, `npm run seed`, `npm run dev`), verify each row live, not by re-reading the code:

```bash
# Secrets: confirm the app refuses to boot with a short JWT_SECRET
JWT_SECRET=too-short PORT=3999 node src/server.js
# Expected: throws "Invalid environment configuration" and exits — does not boot.

# Auth: confirm a tampered JWT is rejected
curl -s -i http://localhost:3000/instances/my-tasks -H "Authorization: Bearer not.a.real.jwt" | head -1
# Expected: 401.

# Transport & headers: confirm helmet headers are present on a live response
curl -s -i http://localhost:3000/health | grep -i "x-content-type-options\|x-dns-prefetch-control"

# Error handling: confirm a 500-shaped internal error never leaks a stack trace
curl -s http://localhost:3000/instances/not-a-uuid -H "Authorization: Bearer $TOKEN"
# Expected: { "error": "instanceId must be a valid UUID" } — no stack trace, no file paths.

# Rate limiting, tenant isolation, SQL-injection handling: already proven live in
# Tasks 2 and 3's test runs against the real dockerized Postgres instance.
```

Record the result of each row against the table below (all should be ✅ by this point):

| Risk area | Verified how |
|---|---|
| Secrets management | Fail-fast boot check above; `.env` never committed (checked every phase) |
| Authentication | JWT tamper-rejection above; `jwt.test.js`, `authMiddleware.test.js` |
| Authorization | `requireAdmin.test.js`, `canAct`-based tests across every instance-action suite |
| SQL injection | Task 3's malicious-string test; UUID format validation on every path/body param |
| Multi-tenant data isolation | Task 2's full endpoint sweep |
| Input validation | `validation.test.js`, `fileValidation.test.js`, Task 1's endpoint-level upload tests |
| Transport & headers | `securityBaseline.test.js`; live helmet header check above |
| Rate limiting | Task 3's live 11-request test |
| Error handling | `errorHandler.js` design (Phase 0); live check above |
| Query performance / indexing | Task 4's live `EXPLAIN` checks |
| Auditability | `instances.history.test.js`'s full audit-log assertions |

- [ ] **Step 3: Run a realistic internal-UAT-style walkthrough**

There is no frontend yet (out of scope per the spec and this build's own scope decision), so a human click-through UAT isn't possible — this step substitutes a full, realistic scripted walkthrough of one real DOK-shaped workflow via the API, standing in for the "internal UAT with one real DOK workflow" checklist item until a UI exists to do it by hand.

Run a complete HR-letter-style 3-stage approval end to end: admin configures a template + 3-stage workflow + document type; a submitter starts an instance, uploads a real edited file, and forwards; a reviewer sends it back once; the submitter re-forwards; a final approver forwards to completion; confirm via `GET /instances/:id/history` that every step is present in order with the correct actor and comment. This exercises the same path Phases 1-4 individually verified, now as one continuous realistic scenario.

- [ ] **Step 4: Update `PROGRESS.md` with the Phase 5 completion summary, noting the full 6-phase build is done, and commit**

```bash
git add PROGRESS.md
git commit -m "docs: update progress log for Phase 5 completion — Phase 1 build complete"
```

## Phase 5 Exit Criteria (the source plan's overall Phase 1 exit criteria)

- [ ] Upload validation rejects wrong file types, oversized files, and mismatched signatures — verified at the live endpoint, not just the unit level.
- [ ] Tenant A can never read or act on tenant B's data under any endpoint — verified by a comprehensive sweep, not spot-checked.
- [ ] The indexes the schema was built around are actually chosen by the query planner at realistic volume.
- [ ] The security checklist (spec §6) is verified against the running system.
- [ ] Full test suite passes.
