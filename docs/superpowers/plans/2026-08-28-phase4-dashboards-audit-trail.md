# Phase 4 — Dashboards & Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every instance's state and history reconstructable from the API alone — a "my tasks" view (assigned to me / waiting on others / completed), a full instance history (versions + audit log), and an admin overview filterable by status and document type.

**Architecture:** A new `dashboardService.js` holds all read-only aggregation logic, separate from `workflowInstanceService.js`'s transactional engine — it imports `getInstanceDetail` and `canAct` but never mutates state. `GET /instances/my-tasks` and `GET /instances/:id/history` are mounted on the existing non-admin `instances` router (any authenticated tenant member); `GET /admin/instances` is mounted on the existing admin `instances` router (admin-only).

**Tech Stack:** No new dependencies — pure Knex queries against Phase 0's existing schema.

**Spec:** `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`

## Global Constraints

- Every query is scoped by `req.user.tenantId` from the JWT — never a tenant_id from the request. (Spec §6)
- "My tasks" buckets are derived from the same `canAct` authorization logic the engine itself uses (Phase 2) — a dashboard must never claim someone is "assigned" to an instance they couldn't actually act on. (Spec §6 "canAct()")
- Instance history returns `instance_versions` and `stage_actions` in full, in chronological order — nothing is filtered or summarized away, since the exit criterion is that history is fully reconstructable from the API alone. (Spec §9 Phase 4)
- The admin overview is read-only and admin-gated (`requireAdmin`) — it must never expose one tenant's instances to another. (Spec §6)

## Design decision: "my tasks" bucket definitions

The spec names the three buckets (`assigned to me`, `waiting on others`, `completed`) but doesn't define their exact membership. This plan defines them as:

- **assigned to me**: `status = 'in_progress'` AND the caller can act on the current stage right now — either they are the named `assignee_user_id` on a `user`-type stage, they already hold the claim (`claimed_by`), or the stage is `role`-type, unclaimed, and they hold that role (eligible to claim).
- **waiting on others**: `status = 'in_progress'`, the caller is `created_by`, but the caller is not in "assigned to me" for it (i.e. it's sitting at someone else's desk).
- **completed**: `status IN ('completed', 'rejected')` AND the caller is `created_by` — the caller's own submissions that reached a terminal state.

---

## Task 1: "My tasks" endpoint

**Files:**
- Create: `backend/src/services/dashboardService.js`
- Modify: `backend/src/routes/instances.js` (add `GET /my-tasks`, mounted **before** the existing `GET /:id` so it isn't swallowed as an `:id` value)
- Test: `backend/tests/instances.myTasks.test.js`

**Interfaces:**
- Consumes: `canAct` (Phase 2, `src/utils/workflowAuthorization.js`).
- Produces: `listMyTasks(tenantId, userId) -> Promise<{ assignedToMe: [], waitingOnOthers: [], completed: [] }>`, each instance entry annotated with `currentStage` (except `completed`, which has no meaningful "current" stage) and `document_type_name`. `GET /instances/my-tasks`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.myTasks.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'e0000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'e0000000-0000-0000-0000-000000000002';
const SUBMITTER_ID = 'e0000000-0000-0000-0000-000000000003';
const REVIEWER_ID = 'e0000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const submitterToken = signToken({ sub: SUBMITTER_ID, tenant_id: TENANT_ID, is_admin: false });
const reviewerToken = signToken({ sub: REVIEWER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('GET /instances/my-tasks', () => {
  let documentTypeId;
  let assignedInstanceId;
  let waitingInstanceId;
  let completedInstanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'My Tasks Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'mt-admin@example.com', password_hash: 'x', is_admin: true },
        { id: SUBMITTER_ID, tenant_id: TENANT_ID, email: 'mt-submitter@example.com', password_hash: 'x' },
        { id: REVIEWER_ID, tenant_id: TENANT_ID, email: 'mt-reviewer@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'My Tasks Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'My Tasks Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Review', assigneeType: 'user', assigneeUserId: REVIEWER_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'My Tasks Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;

    // Instance 1: submitted by SUBMITTER, sitting at REVIEWER's desk.
    const started1 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${submitterToken}`)
      .send({ documentTypeId });
    assignedInstanceId = started1.body.id;
    waitingInstanceId = started1.body.id;

    // Instance 2: submitted by SUBMITTER, forwarded past REVIEWER, now completed.
    const started2 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${submitterToken}`)
      .send({ documentTypeId });
    completedInstanceId = started2.body.id;
    await request(app)
      .post(`/instances/${completedInstanceId}/forward`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({});
  });

  afterAll(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
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

  it('puts the instance in assignedToMe for the current stage assignee', async () => {
    const response = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${reviewerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.assignedToMe.map((i) => i.id)).toContain(assignedInstanceId);
  });

  it('puts the same instance in waitingOnOthers for the submitter', async () => {
    const response = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${submitterToken}`);
    expect(response.status).toBe(200);
    expect(response.body.waitingOnOthers.map((i) => i.id)).toContain(waitingInstanceId);
    expect(response.body.assignedToMe.map((i) => i.id)).not.toContain(waitingInstanceId);
  });

  it('puts a completed submission in completed for the submitter', async () => {
    const response = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${submitterToken}`);
    expect(response.status).toBe(200);
    expect(response.body.completed.map((i) => i.id)).toContain(completedInstanceId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/instances.myTasks.test.js`
Expected: FAIL — module/route not found.

- [ ] **Step 3: Write `backend/src/services/dashboardService.js`**

```js
const db = require('../config/db');
const { canAct } = require('../utils/workflowAuthorization');

async function listMyTasks(tenantId, userId) {
  const inProgress = await db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where({ 'workflow_instances.tenant_id': tenantId, 'workflow_instances.status': 'in_progress' })
    .select(
      'workflow_instances.*',
      'document_types.name as document_type_name',
      'document_types.workflow_template_id',
    );

  const userRoleIds = (
    await db('user_roles').where({ tenant_id: tenantId, user_id: userId }).select('role_id')
  ).map((row) => row.role_id);

  const assignedToMe = [];
  const waitingOnOthers = [];

  for (const instance of inProgress) {
    const stage = await db('workflow_stages')
      .where({
        tenant_id: tenantId,
        workflow_template_id: instance.workflow_template_id,
        stage_order: instance.current_stage_order,
      })
      .first();

    const eligibleToClaimRole =
      stage.assignee_type === 'role' && !instance.claimed_by && userRoleIds.includes(stage.assignee_role_id);
    const isMine = canAct(stage, instance, userId) || eligibleToClaimRole;

    if (isMine) {
      assignedToMe.push({ ...instance, currentStage: stage });
    } else if (instance.created_by === userId) {
      waitingOnOthers.push({ ...instance, currentStage: stage });
    }
  }

  const completed = await db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where({ 'workflow_instances.tenant_id': tenantId, 'workflow_instances.created_by': userId })
    .whereIn('workflow_instances.status', ['completed', 'rejected'])
    .select('workflow_instances.*', 'document_types.name as document_type_name')
    .orderBy('workflow_instances.updated_at', 'desc');

  return { assignedToMe, waitingOnOthers, completed };
}

module.exports = { listMyTasks };
```

- [ ] **Step 4: Add the route to `backend/src/routes/instances.js`**

Add near the top, with the other requires:
```js
const { listMyTasks } = require('../services/dashboardService');
```

Add **immediately after `router.use(authenticate);`, before the existing `router.post('/', ...)`** — it must come before `router.get('/:id', ...)` or Express will match `/my-tasks` as `:id`:
```js
router.get('/my-tasks', async (req, res, next) => {
  try {
    const tasks = await listMyTasks(req.user.tenantId, req.user.userId);
    res.status(200).json(tasks);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/instances.myTasks.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/dashboardService.js src/routes/instances.js tests/instances.myTasks.test.js
git commit -m "feat: add my-tasks dashboard endpoint"
```

---

## Task 2: Instance history (full version history + audit log)

**Files:**
- Modify: `backend/src/services/dashboardService.js` (add `getInstanceHistory`)
- Modify: `backend/src/routes/instances.js` (add `GET /:id/history`)
- Test: `backend/tests/instances.history.test.js`

**Interfaces:**
- Consumes: `getInstanceDetail` (Phase 2, `src/services/workflowInstanceService.js`).
- Produces: `getInstanceHistory(tenantId, instanceId) -> Promise<{ instance, documentType, currentStage, versions: [], auditLog: [] }>`; `GET /instances/:id/history`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.history.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'e1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'e1000000-0000-0000-0000-000000000002';
const STAGE1_USER = 'e1000000-0000-0000-0000-000000000003';
const STAGE2_USER = 'e1000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const stage1Token = signToken({ sub: STAGE1_USER, tenant_id: TENANT_ID, is_admin: false });
const stage2Token = signToken({ sub: STAGE2_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('GET /instances/:id/history', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'History Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'hist-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STAGE1_USER, tenant_id: TENANT_ID, email: 'hist-stage1@example.com', password_hash: 'x' },
        { id: STAGE2_USER, tenant_id: TENANT_ID, email: 'hist-stage2@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'History Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'History Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: STAGE1_USER });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 2, name: 'Review', assigneeType: 'user', assigneeUserId: STAGE2_USER });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'History Doc',
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
      .attach('file', validDocxBuffer, 'v2.docx');
    await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .attach('file', validDocxBuffer, 'v3.docx');
    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ comment: 'moving on' });
    await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ comment: 'one more pass' });
  });

  afterAll(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
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

  it('returns the full version history in order', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/history`)
      .set('Authorization', `Bearer ${stage1Token}`);
    expect(response.status).toBe(200);
    expect(response.body.versions.map((v) => v.version_number)).toEqual([1, 2]);
  });

  it('returns the full stage_actions audit log in order, with actors and comments', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/history`)
      .set('Authorization', `Bearer ${stage1Token}`);
    expect(response.body.auditLog.map((a) => a.action_type)).toEqual(['forward', 'send_back']);
    expect(response.body.auditLog[0].actor_id).toBe(STAGE1_USER);
    expect(response.body.auditLog[0].comment).toBe('moving on');
    expect(response.body.auditLog[1].actor_id).toBe(STAGE2_USER);
  });

  it('returns 404 for an instance outside the caller\'s tenant', async () => {
    const response = await request(app)
      .get('/instances/00000000-0000-0000-0000-000000000099/history')
      .set('Authorization', `Bearer ${stage1Token}`);
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.history.test.js`
Expected: FAIL — route not found.

- [ ] **Step 3: Add `getInstanceHistory` to `backend/src/services/dashboardService.js`**

Add near the top:
```js
const { getInstanceDetail } = require('./workflowInstanceService');
```

Append before `module.exports`:
```js
async function getInstanceHistory(tenantId, instanceId) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  const versions = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('version_number', 'asc');

  const auditLog = await db('stage_actions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('created_at', 'asc');

  return {
    instance,
    documentType: { id: documentType.id, name: documentType.name },
    currentStage: stage,
    versions,
    auditLog,
  };
}
```

Update `module.exports` to:
```js
module.exports = { listMyTasks, getInstanceHistory };
```

- [ ] **Step 4: Add the route to `backend/src/routes/instances.js`**

Update the destructured import:
```js
const { listMyTasks, getInstanceHistory } = require('../services/dashboardService');
```

Add anywhere after the `GET /:id` route (order doesn't matter here — `/:id/history` has two segments, so it can never collide with `/:id`):
```js
router.get('/:id/history', async (req, res, next) => {
  try {
    const history = await getInstanceHistory(req.user.tenantId, req.params.id);
    res.status(200).json(history);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/instances.history.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/dashboardService.js src/routes/instances.js tests/instances.history.test.js
git commit -m "feat: add instance history endpoint (versions + audit log)"
```

---

## Task 3: Admin overview (filterable by status and document type)

**Files:**
- Modify: `backend/src/services/dashboardService.js` (add `listInstancesForAdmin`)
- Modify: `backend/src/routes/admin/instances.js` (add `GET /`)
- Test: `backend/tests/instances.adminOverview.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `listInstancesForAdmin(tenantId, { status, documentTypeId }) -> Promise<instance[]>`; `GET /admin/instances?status=&documentTypeId=`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.adminOverview.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'e2000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'e2000000-0000-0000-0000-000000000002';
const USER_ID = 'e2000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const userToken = signToken({ sub: USER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('GET /admin/instances', () => {
  let documentTypeAId;
  let documentTypeBId;
  let inProgressId;
  let completedId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Overview Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ov-admin@example.com', password_hash: 'x', is_admin: true },
        { id: USER_ID, tenant_id: TENANT_ID, email: 'ov-user@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Overview Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplateA = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Overview Approval A' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateA.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: USER_ID });

    const workflowTemplateB = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Overview Approval B' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateB.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: USER_ID });

    const documentTypeA = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Overview Doc A',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplateA.body.id,
      });
    documentTypeAId = documentTypeA.body.id;

    const documentTypeB = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Overview Doc B',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplateB.body.id,
      });
    documentTypeBId = documentTypeB.body.id;

    const started1 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ documentTypeId: documentTypeAId });
    inProgressId = started1.body.id;

    const started2 = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ documentTypeId: documentTypeBId });
    completedId = started2.body.id;
    await request(app)
      .post(`/instances/${completedId}/forward`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});
  });

  afterAll(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
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

  it('rejects a non-admin', async () => {
    const response = await request(app).get('/admin/instances').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
  });

  it('lists all instances for the tenant with no filter', async () => {
    const response = await request(app).get('/admin/instances').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    const ids = response.body.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([inProgressId, completedId]));
  });

  it('filters by status', async () => {
    const response = await request(app)
      .get('/admin/instances?status=completed')
      .set('Authorization', `Bearer ${adminToken}`);
    const ids = response.body.map((i) => i.id);
    expect(ids).toContain(completedId);
    expect(ids).not.toContain(inProgressId);
  });

  it('filters by documentTypeId', async () => {
    const response = await request(app)
      .get(`/admin/instances?documentTypeId=${documentTypeAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const ids = response.body.map((i) => i.id);
    expect(ids).toContain(inProgressId);
    expect(ids).not.toContain(completedId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.adminOverview.test.js`
Expected: FAIL — route not found.

- [ ] **Step 3: Add `listInstancesForAdmin` to `backend/src/services/dashboardService.js`**

Append before `module.exports`:
```js
async function listInstancesForAdmin(tenantId, { status, documentTypeId } = {}) {
  let query = db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where({ 'workflow_instances.tenant_id': tenantId })
    .select('workflow_instances.*', 'document_types.name as document_type_name')
    .orderBy('workflow_instances.created_at', 'desc');

  if (status) {
    query = query.where('workflow_instances.status', status);
  }
  if (documentTypeId) {
    query = query.where('workflow_instances.document_type_id', documentTypeId);
  }

  return query;
}
```

Update `module.exports` to:
```js
module.exports = { listMyTasks, getInstanceHistory, listInstancesForAdmin };
```

- [ ] **Step 4: Add the route to `backend/src/routes/admin/instances.js`**

Update the destructured import:
```js
const { reassignInstance, listInstancesForAdmin } = require('../../services/workflowInstanceService');
```
Wait — `listInstancesForAdmin` lives in `dashboardService`, not `workflowInstanceService`. Import it separately:
```js
const { reassignInstance } = require('../../services/workflowInstanceService');
const { listInstancesForAdmin } = require('../../services/dashboardService');
```

Add before `module.exports = router;`:
```js
router.get('/', async (req, res, next) => {
  try {
    const instances = await listInstancesForAdmin(req.user.tenantId, {
      status: req.query.status,
      documentTypeId: req.query.documentTypeId,
    });
    res.status(200).json(instances);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/instances.adminOverview.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/dashboardService.js src/routes/admin/instances.js tests/instances.adminOverview.test.js
git commit -m "feat: add admin instance overview (filterable by status and document type)"
```

---

## Task 4: End-to-end exit-criteria verification

**Files:** none created — verification only, plus `PROGRESS.md`.

- [ ] **Step 1: Run the full automated test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all suites pass (Phases 0-3's 77 tests + this phase's new tests).

- [ ] **Step 2: Verify against the running stack**

With the stack running, reuse an instance from an earlier phase's walkthrough (or build a fresh one) and confirm its full history is reconstructable without touching the database:

```bash
curl -s http://localhost:3000/instances/$INSTANCE_ID/history -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/instances/my-tasks -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:3000/admin/instances?status=in_progress" -H "Authorization: Bearer $TOKEN"
```

Expected: `/history` returns the full `versions` and `auditLog` arrays matching everything done to that instance across every prior phase's walkthrough; `/my-tasks` correctly buckets it; the admin overview filters correctly by status.

- [ ] **Step 3: Update `PROGRESS.md` with the Phase 4 completion summary and commit**

```bash
git add PROGRESS.md
git commit -m "docs: update progress log for Phase 4 completion"
```

## Phase 4 Exit Criteria (verify all before moving to Phase 5)

- [ ] Any instance's full history (every version, every stage action with actor/timestamp/comment) can be reconstructed from `GET /instances/:id/history` alone.
- [ ] `GET /instances/my-tasks` correctly buckets instances into assigned to me / waiting on others / completed, using the same `canAct` logic the engine itself enforces.
- [ ] `GET /admin/instances` lists every instance for the tenant and correctly filters by `status` and `documentTypeId`; non-admins are rejected with 403.
- [ ] Full test suite passes.
