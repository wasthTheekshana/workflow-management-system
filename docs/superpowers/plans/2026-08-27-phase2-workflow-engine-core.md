# Phase 2 — Workflow Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a document walk through a full multi-stage workflow via API calls alone: start an instance from a document type, claim role-assigned stages, save new versions, and transition with forward / send-back / hard-reject — plus admin reassignment for stuck instances and clone-after-reject resubmission.

**Architecture:** A new `workflowInstanceService.js` holds all engine logic (never in route handlers), built around one shared loader (`getInstanceDetail`) that resolves an instance's current stage through `document_types -> workflow_templates -> workflow_stages`. Authorization is centralized in a single pure function, `canAct(stage, instance, userId)`, named to match the spec's own reference to "canAct() in the workflow engine" (§6). Non-admin instance actions live under `/instances/*` (any authenticated tenant member may start/view; stage actions are gated by `canAct`); admin reassignment lives under `/admin/instances/*`.

**Tech Stack:** Same as Phases 0-1 (Express, Knex/Postgres, multer). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`

## Global Constraints

- Every instance action is scoped by `req.user.tenantId` from the JWT — never a tenant_id from the request. (Spec §6)
- `canAct(stage, instance, userId)` is the single authorization gate for claim/upload/forward/send-back/reject: if `instance.claimed_by` is set, only that user may act (this is what lets admin reassignment and role-claims work uniformly); otherwise, only a `user`-type stage's named `assignee_user_id` may act, and a `role`-type stage with no claim yet authorizes no one. (Spec §5.2, §6)
- A role-assigned stage requires an explicit claim before any action; claiming requires the caller to actually hold that role (`user_roles`) and requires the instance to be unclaimed. (Spec §5.2, §4 "Assignment flexibility")
- Every transition (`claim`, `forward`, `send_back`, `reject`, `reassign`) is recorded as its own `stage_actions` row with actor, timestamp, and optional comment — nothing is a hard delete. (Spec §6 "Auditability")
- `send_back` defaults to exactly one stage back (`current_stage_order - 1`); this is a Phase 1 open decision the spec defers extending, not something this phase changes. (Spec §11)
- Instance file uploads are validated against the **document type's own** `allowed_extensions`/`max_upload_size_bytes` (not a hardcoded constant) — those columns exist precisely for this. (Spec §3 `document_types`)
- Resubmission after a hard reject clones the rejected instance's last saved version into a fresh instance at stage 1, rather than reopening the rejected one. (Spec §4 "Resubmission after hard reject")
- Admin reassignment is scoped to a single stuck instance (sets `claimed_by`), never the workflow template's stage definition — reassigning one instance must never change how other instances of the same template behave. (Spec §4 "Stuck / absent assignee")

---

## Task 1: `canAct` authorization helper

**Files:**
- Create: `backend/src/utils/workflowAuthorization.js`
- Test: `backend/tests/workflowAuthorization.test.js`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `canAct(stage: { assignee_type, assignee_user_id }, instance: { claimed_by }, userId: string) -> boolean`. Every task below imports this by name.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/workflowAuthorization.test.js
const { canAct } = require('../src/utils/workflowAuthorization');

describe('canAct', () => {
  it('authorizes the assigned user on a user-type stage with no claim', () => {
    const stage = { assignee_type: 'user', assignee_user_id: 'user-1' };
    expect(canAct(stage, { claimed_by: null }, 'user-1')).toBe(true);
  });

  it('rejects a different user on a user-type stage with no claim', () => {
    const stage = { assignee_type: 'user', assignee_user_id: 'user-1' };
    expect(canAct(stage, { claimed_by: null }, 'user-2')).toBe(false);
  });

  it('rejects anyone on a role-type stage with no claim', () => {
    const stage = { assignee_type: 'role', assignee_role_id: 'role-1' };
    expect(canAct(stage, { claimed_by: null }, 'user-1')).toBe(false);
  });

  it('authorizes the claimant regardless of stage assignee, once claimed', () => {
    const stage = { assignee_type: 'role', assignee_role_id: 'role-1' };
    expect(canAct(stage, { claimed_by: 'user-2' }, 'user-2')).toBe(true);
    expect(canAct(stage, { claimed_by: 'user-2' }, 'user-3')).toBe(false);
  });

  it('lets a claim override the originally assigned user on a user-type stage (admin reassignment)', () => {
    const stage = { assignee_type: 'user', assignee_user_id: 'user-1' };
    expect(canAct(stage, { claimed_by: 'user-9' }, 'user-9')).toBe(true);
    expect(canAct(stage, { claimed_by: 'user-9' }, 'user-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/workflowAuthorization.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `backend/src/utils/workflowAuthorization.js`**

```js
function canAct(stage, instance, userId) {
  if (instance.claimed_by) {
    return instance.claimed_by === userId;
  }
  if (stage.assignee_type === 'user') {
    return stage.assignee_user_id === userId;
  }
  return false;
}

module.exports = { canAct };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/workflowAuthorization.test.js`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/workflowAuthorization.js tests/workflowAuthorization.test.js
git commit -m "feat: add canAct workflow authorization helper"
```

---

## Task 2: Start instance and fetch instance detail

**Files:**
- Create: `backend/src/services/workflowInstanceService.js`
- Create: `backend/src/routes/instances.js`
- Modify: `backend/src/app.js` (mount the router)
- Test: `backend/tests/instances.startAndGet.test.js`

**Interfaces:**
- Consumes: Phase 1's `document_types`, `template_file_versions`, `workflow_templates`, `workflow_stages` tables; `assertUuid` (Phase 1).
- Produces: `getInstanceDetail(tenantId, instanceId) -> Promise<{ instance, documentType, stage }>` (throws `AppError(404)`), `startInstance(tenantId, userId, documentTypeId) -> Promise<instance>`. `POST /instances`, `GET /instances/:id`. Every later task in this phase calls `getInstanceDetail`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.startAndGet.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c0000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c0000000-0000-0000-0000-000000000002';
const USER_ID = 'c0000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const userToken = signToken({ sub: USER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('start and fetch a workflow instance', () => {
  let documentTypeId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Instances Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'inst-admin@example.com', password_hash: 'x', is_admin: true },
        { id: USER_ID, tenant_id: TENANT_ID, email: 'inst-user@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SRS' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SRS Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: USER_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'SRS',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;
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

  it('starts an instance at stage 1 and fetches its detail', async () => {
    const startResponse = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ documentTypeId });
    expect(startResponse.status).toBe(201);
    expect(startResponse.body.current_stage_order).toBe(1);
    expect(startResponse.body.status).toBe('in_progress');

    const getResponse = await request(app)
      .get(`/instances/${startResponse.body.id}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.currentStage.name).toBe('Draft');
  });

  it('rejects a documentTypeId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ documentTypeId: '00000000-0000-0000-0000-000000000099' });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.startAndGet.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `backend/src/services/workflowInstanceService.js`**

```js
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid } = require('../utils/validation');

async function getInstanceDetail(tenantId, instanceId) {
  assertUuid(instanceId, 'instanceId');
  const instance = await db('workflow_instances').where({ tenant_id: tenantId, id: instanceId }).first();
  if (!instance) {
    throw new AppError(404, 'Workflow instance not found');
  }

  const documentType = await db('document_types')
    .where({ tenant_id: tenantId, id: instance.document_type_id })
    .first();

  const stage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: documentType.workflow_template_id,
      stage_order: instance.current_stage_order,
    })
    .first();

  return { instance, documentType, stage };
}

async function startInstance(tenantId, userId, documentTypeId) {
  assertUuid(documentTypeId, 'documentTypeId');
  const documentType = await db('document_types').where({ tenant_id: tenantId, id: documentTypeId }).first();
  if (!documentType) {
    throw new AppError(400, 'documentTypeId does not belong to this tenant');
  }

  const latestTemplateVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, template_file_id: documentType.template_file_id })
    .orderBy('version_number', 'desc')
    .first();
  if (!latestTemplateVersion) {
    throw new AppError(400, 'The linked template file has no uploaded versions yet');
  }

  const firstStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: documentType.workflow_template_id, stage_order: 1 })
    .first();
  if (!firstStage) {
    throw new AppError(400, 'The linked workflow template has no stages configured yet');
  }

  const [instance] = await db('workflow_instances')
    .insert({
      tenant_id: tenantId,
      document_type_id: documentTypeId,
      template_file_version_id: latestTemplateVersion.id,
      current_stage_order: 1,
      status: 'in_progress',
      created_by: userId,
    })
    .returning('*');

  return instance;
}

module.exports = { getInstanceDetail, startInstance };
```

- [ ] **Step 4: Write `backend/src/routes/instances.js`**

```js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { startInstance, getInstanceDetail } = require('../services/workflowInstanceService');

const router = express.Router();

router.use(authenticate);

router.post('/', async (req, res, next) => {
  try {
    const instance = await startInstance(req.user.tenantId, req.user.userId, req.body.documentTypeId);
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { instance, stage } = await getInstanceDetail(req.user.tenantId, req.params.id);
    res.status(200).json({ ...instance, currentStage: stage });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Mount the router in `backend/src/app.js`**

Add with the other route imports:
```js
const instancesRouter = require('./routes/instances');
```
Add after the `/admin/document-types` mount:
```js
app.use('/instances', instancesRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/instances.startAndGet.test.js`
Expected: PASS, all 2 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/services/workflowInstanceService.js src/routes/instances.js src/app.js tests/instances.startAndGet.test.js
git commit -m "feat: add start-instance and get-instance-detail engine core"
```

---

## Task 3: Claim flow for role-assigned stages

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js` (add `claimInstance`)
- Modify: `backend/src/routes/instances.js` (add the claim route)
- Test: `backend/tests/instances.claim.test.js`

**Interfaces:**
- Consumes: `getInstanceDetail` (Task 2); `user_roles` table (Phase 0).
- Produces: `claimInstance(tenantId, userId, instanceId) -> Promise<instance>`; `POST /instances/:id/claim`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.claim.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.claim.test.js`
Expected: FAIL — route does not exist (404).

- [ ] **Step 3: Add `claimInstance` to `backend/src/services/workflowInstanceService.js`**

Append before `module.exports`:
```js
async function claimInstance(tenantId, userId, instanceId) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be claimed');
  }
  if (stage.assignee_type !== 'role') {
    throw new AppError(400, 'The current stage is not role-assigned; claiming does not apply');
  }
  if (instance.claimed_by) {
    throw new AppError(400, 'This instance has already been claimed');
  }

  const hasRole = await db('user_roles')
    .where({ tenant_id: tenantId, user_id: userId, role_id: stage.assignee_role_id })
    .first();
  if (!hasRole) {
    throw new AppError(403, 'You do not hold the role assigned to this stage');
  }

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ claimed_by: userId })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'claim',
    from_stage_order: instance.current_stage_order,
    to_stage_order: instance.current_stage_order,
    actor_id: userId,
  });

  return updated;
}
```

Update `module.exports` to:
```js
module.exports = { getInstanceDetail, startInstance, claimInstance };
```

- [ ] **Step 4: Add the claim route to `backend/src/routes/instances.js`**

Update the destructured import:
```js
const { startInstance, getInstanceDetail, claimInstance } = require('../services/workflowInstanceService');
```

Add before `module.exports = router;`:
```js
router.post('/:id/claim', async (req, res, next) => {
  try {
    const instance = await claimInstance(req.user.tenantId, req.user.userId, req.params.id);
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/instances.claim.test.js`
Expected: PASS, all 2 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/workflowInstanceService.js src/routes/instances.js tests/instances.claim.test.js
git commit -m "feat: add claim flow for role-assigned stages"
```

---

## Task 4: Save-version cycle (upload and download the current file)

**Files:**
- Modify: `backend/src/services/fileStorageService.js` (export `STORAGE_ROOT`)
- Modify: `backend/src/services/workflowInstanceService.js` (add `addInstanceVersion`, `getCurrentFilePath`)
- Modify: `backend/src/routes/instances.js` (add the versions/current-file routes)
- Test: `backend/tests/instances.versions.test.js`

**Interfaces:**
- Consumes: `canAct` (Task 1), `getInstanceDetail` (Task 2), `assertAllowedUpload`/`saveUploadedFile` (Phase 1), `upload` (Phase 1's multer config).
- Produces: `addInstanceVersion(tenantId, userId, instanceId, file) -> Promise<version>`, `getCurrentFilePath(tenantId, instanceId) -> Promise<absolutePath>`; `POST /instances/:id/versions`, `GET /instances/:id/current-file`.

- [ ] **Step 1: Export `STORAGE_ROOT` from `backend/src/services/fileStorageService.js`**

Change the final line from:
```js
module.exports = { saveUploadedFile };
```
to:
```js
module.exports = { saveUploadedFile, STORAGE_ROOT };
```

- [ ] **Step 2: Write the failing test**

```js
// backend/tests/instances.versions.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c2000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c2000000-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'c2000000-0000-0000-0000-000000000003';
const OUTSIDER_ID = 'c2000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const assigneeToken = signToken({ sub: ASSIGNEE_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const templateBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('template-v1')]);
const editedBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('edited-by-assignee')]);

describe('instance save-version cycle', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Versions Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ver-admin@example.com', password_hash: 'x', is_admin: true },
        { id: ASSIGNEE_ID, tenant_id: TENANT_ID, email: 'ver-assignee@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'ver-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Versioned Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', templateBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Versioned Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ASSIGNEE_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Versioned Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;
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

  it('serves the snapshotted template before any instance version exists', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/current-file`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.status).toBe(200);
    expect(response.body.toString()).toContain('template-v1');
  });

  it('rejects an upload from someone who is not the stage assignee', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .attach('file', editedBuffer, 'edited.docx');
    expect(response.status).toBe(403);
  });

  it('accepts an upload from the assignee and serves it as the current file', async () => {
    const uploadResponse = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .attach('file', editedBuffer, 'edited.docx');
    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.version_number).toBe(1);

    const currentFile = await request(app)
      .get(`/instances/${instanceId}/current-file`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(currentFile.status).toBe(200);
    expect(currentFile.body.toString()).toContain('edited-by-assignee');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/instances.versions.test.js`
Expected: FAIL — routes do not exist (404).

- [ ] **Step 4: Add `addInstanceVersion` and `getCurrentFilePath` to `backend/src/services/workflowInstanceService.js`**

Add near the top, with the other requires:
```js
const path = require('path');
const { canAct } = require('../utils/workflowAuthorization');
const { assertAllowedUpload } = require('../utils/fileValidation');
const { saveUploadedFile, STORAGE_ROOT } = require('./fileStorageService');
```

Append before `module.exports`:
```js
async function addInstanceVersion(tenantId, userId, instanceId, file) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances accept new versions');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }

  assertAllowedUpload(file, documentType.allowed_extensions, documentType.max_upload_size_bytes);

  const latestVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .max('version_number as max')
    .first();
  const nextVersionNumber = (latestVersion && latestVersion.max ? latestVersion.max : 0) + 1;

  const extension = file.originalname.split('.').pop().toLowerCase();
  const relativePath = await saveUploadedFile(tenantId, file.buffer, extension);

  const [version] = await db('instance_versions')
    .insert({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      version_number: nextVersionNumber,
      file_path: relativePath,
      uploaded_by: userId,
    })
    .returning('*');

  return version;
}

async function getCurrentFilePath(tenantId, instanceId) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);

  const latestInstanceVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('version_number', 'desc')
    .first();

  const relativePath = latestInstanceVersion
    ? latestInstanceVersion.file_path
    : (
        await db('template_file_versions')
          .where({ tenant_id: tenantId, id: instance.template_file_version_id })
          .first()
      ).file_path;

  return path.join(STORAGE_ROOT, relativePath);
}
```

Update `module.exports` to:
```js
module.exports = { getInstanceDetail, startInstance, claimInstance, addInstanceVersion, getCurrentFilePath };
```

- [ ] **Step 5: Add the routes to `backend/src/routes/instances.js`**

Add near the top:
```js
const { upload } = require('../config/multerUpload');
```

Update the destructured import:
```js
const {
  startInstance,
  getInstanceDetail,
  claimInstance,
  addInstanceVersion,
  getCurrentFilePath,
} = require('../services/workflowInstanceService');
```

Add before `module.exports = router;`:
```js
router.post('/:id/versions', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }
    const version = await addInstanceVersion(req.user.tenantId, req.user.userId, req.params.id, req.file);
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/current-file', async (req, res, next) => {
  try {
    const absolutePath = await getCurrentFilePath(req.user.tenantId, req.params.id);
    res.download(absolutePath);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/instances.versions.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/services/fileStorageService.js src/services/workflowInstanceService.js src/routes/instances.js tests/instances.versions.test.js
git commit -m "feat: add instance save-version cycle (upload and download current file)"
```

---

## Task 5: Forward transition

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js` (add `forwardInstance`)
- Modify: `backend/src/routes/instances.js` (add the forward route)
- Test: `backend/tests/instances.forward.test.js`

**Interfaces:**
- Consumes: `canAct`, `getInstanceDetail`.
- Produces: `forwardInstance(tenantId, userId, instanceId, comment) -> Promise<instance>`; `POST /instances/:id/forward`. When there is no next stage, the instance's `status` becomes `'completed'` instead of advancing `current_stage_order`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.forward.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c3000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c3000000-0000-0000-0000-000000000002';
const STAGE1_USER = 'c3000000-0000-0000-0000-000000000003';
const STAGE2_USER = 'c3000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const stage1Token = signToken({ sub: STAGE1_USER, tenant_id: TENANT_ID, is_admin: false });
const stage2Token = signToken({ sub: STAGE2_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('forward transition', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Forward Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'fwd-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STAGE1_USER, tenant_id: TENANT_ID, email: 'fwd-stage1@example.com', password_hash: 'x' },
        { id: STAGE2_USER, tenant_id: TENANT_ID, email: 'fwd-stage2@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '2-Stage Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '2-Stage Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: STAGE1_USER });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 2, name: 'Final', assigneeType: 'user', assigneeUserId: STAGE2_USER });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '2-Stage Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ documentTypeId: documentType.body.id });
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
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects a forward from someone who is not the current stage assignee', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({});
    expect(response.status).toBe(403);
  });

  it('advances stage 1 to stage 2 and resets the claim', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ comment: 'Looks good' });
    expect(response.status).toBe(200);
    expect(response.body.current_stage_order).toBe(2);
    expect(response.body.status).toBe('in_progress');
    expect(response.body.claimed_by).toBeNull();
  });

  it('marks the instance completed when forwarded from the last stage', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('completed');
    expect(response.body.current_stage_order).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.forward.test.js`
Expected: FAIL — route does not exist (404).

- [ ] **Step 3: Add `forwardInstance` to `backend/src/services/workflowInstanceService.js`**

Append before `module.exports`:
```js
async function forwardInstance(tenantId, userId, instanceId, comment) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be forwarded');
  }
  if (!stage.allowed_actions.includes('forward')) {
    throw new AppError(400, 'The current stage does not allow forwarding');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }

  const nextStage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: documentType.workflow_template_id,
      stage_order: instance.current_stage_order + 1,
    })
    .first();

  const updates = nextStage
    ? { current_stage_order: nextStage.stage_order, claimed_by: null }
    : { status: 'completed' };

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update(updates)
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'forward',
    from_stage_order: instance.current_stage_order,
    to_stage_order: nextStage ? nextStage.stage_order : instance.current_stage_order,
    actor_id: userId,
    comment: comment || null,
  });

  return updated;
}
```

Update `module.exports` to:
```js
module.exports = {
  getInstanceDetail,
  startInstance,
  claimInstance,
  addInstanceVersion,
  getCurrentFilePath,
  forwardInstance,
};
```

- [ ] **Step 4: Add the route to `backend/src/routes/instances.js`**

Update the destructured import to include `forwardInstance`, then add before `module.exports = router;`:
```js
router.post('/:id/forward', async (req, res, next) => {
  try {
    const instance = await forwardInstance(req.user.tenantId, req.user.userId, req.params.id, req.body.comment);
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/instances.forward.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/workflowInstanceService.js src/routes/instances.js tests/instances.forward.test.js
git commit -m "feat: add forward transition to workflow engine"
```

---

## Task 6: Send-back transition

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js` (add `sendBackInstance`)
- Modify: `backend/src/routes/instances.js` (add the send-back route)
- Test: `backend/tests/instances.sendBack.test.js`

**Interfaces:**
- Consumes: `canAct`, `getInstanceDetail`.
- Produces: `sendBackInstance(tenantId, userId, instanceId, comment) -> Promise<instance>`; `POST /instances/:id/send-back`. Always targets exactly `current_stage_order - 1` (Spec §11).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.sendBack.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c4000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c4000000-0000-0000-0000-000000000002';
const STAGE1_USER = 'c4000000-0000-0000-0000-000000000003';
const STAGE2_USER = 'c4000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const stage1Token = signToken({ sub: STAGE1_USER, tenant_id: TENANT_ID, is_admin: false });
const stage2Token = signToken({ sub: STAGE2_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('send-back transition', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Send Back Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'sb-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STAGE1_USER, tenant_id: TENANT_ID, email: 'sb-stage1@example.com', password_hash: 'x' },
        { id: STAGE2_USER, tenant_id: TENANT_ID, email: 'sb-stage2@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Send Back Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Send Back Approval' });
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
        name: 'Send Back Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;

    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});
  });

  afterAll(async () => {
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

  it('sends the instance from stage 2 back to stage 1', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ comment: 'Needs more detail' });
    expect(response.status).toBe(200);
    expect(response.body.current_stage_order).toBe(1);
    expect(response.body.claimed_by).toBeNull();
  });

  it('rejects sending back from the first stage', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/send-back`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.sendBack.test.js`
Expected: FAIL — route does not exist (404).

- [ ] **Step 3: Add `sendBackInstance` to `backend/src/services/workflowInstanceService.js`**

Append before `module.exports`:
```js
async function sendBackInstance(tenantId, userId, instanceId, comment) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be sent back');
  }
  if (!stage.allowed_actions.includes('send_back')) {
    throw new AppError(400, 'The current stage does not allow sending back');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }
  if (instance.current_stage_order <= 1) {
    throw new AppError(400, 'Cannot send back from the first stage');
  }

  const targetStageOrder = instance.current_stage_order - 1;

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ current_stage_order: targetStageOrder, claimed_by: null })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'send_back',
    from_stage_order: instance.current_stage_order,
    to_stage_order: targetStageOrder,
    actor_id: userId,
    comment: comment || null,
  });

  return updated;
}
```

Update `module.exports` to:
```js
module.exports = {
  getInstanceDetail,
  startInstance,
  claimInstance,
  addInstanceVersion,
  getCurrentFilePath,
  forwardInstance,
  sendBackInstance,
};
```

- [ ] **Step 4: Add the route to `backend/src/routes/instances.js`**

Update the destructured import to include `sendBackInstance`, then add before `module.exports = router;`:
```js
router.post('/:id/send-back', async (req, res, next) => {
  try {
    const instance = await sendBackInstance(req.user.tenantId, req.user.userId, req.params.id, req.body.comment);
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/instances.sendBack.test.js`
Expected: PASS, all 2 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/workflowInstanceService.js src/routes/instances.js tests/instances.sendBack.test.js
git commit -m "feat: add send-back transition to workflow engine"
```

---

## Task 7: Hard reject and clone-after-reject resubmission

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js` (add `rejectInstance`, `resubmitInstance`)
- Modify: `backend/src/routes/instances.js` (add the reject/resubmit routes)
- Test: `backend/tests/instances.rejectAndResubmit.test.js`

**Interfaces:**
- Consumes: `canAct`, `getInstanceDetail`.
- Produces: `rejectInstance(tenantId, userId, instanceId, comment) -> Promise<instance>`, `resubmitInstance(tenantId, userId, instanceId) -> Promise<newInstance>`; `POST /instances/:id/reject`, `POST /instances/:id/resubmit`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.rejectAndResubmit.test.js
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
      .set('Authorization', `Bearer ${stage1Token}`);
    expect(currentFile.status).toBe(200);
    expect(currentFile.body.toString()).toContain('final-draft-before-rejection');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.rejectAndResubmit.test.js`
Expected: FAIL — routes do not exist (404).

- [ ] **Step 3: Add `rejectInstance` and `resubmitInstance` to `backend/src/services/workflowInstanceService.js`**

Append before `module.exports`:
```js
async function rejectInstance(tenantId, userId, instanceId, comment) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be rejected');
  }
  if (!stage.allowed_actions.includes('reject')) {
    throw new AppError(400, 'The current stage does not allow rejecting');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ status: 'rejected' })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'reject',
    from_stage_order: instance.current_stage_order,
    to_stage_order: null,
    actor_id: userId,
    comment: comment || null,
  });

  return updated;
}

async function resubmitInstance(tenantId, userId, instanceId) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'rejected') {
    throw new AppError(400, 'Only rejected instances can be resubmitted');
  }
  if (instance.created_by !== userId) {
    throw new AppError(403, 'Only the original submitter can resubmit this instance');
  }

  const [newInstance] = await db('workflow_instances')
    .insert({
      tenant_id: tenantId,
      document_type_id: instance.document_type_id,
      template_file_version_id: instance.template_file_version_id,
      current_stage_order: 1,
      status: 'in_progress',
      created_by: userId,
    })
    .returning('*');

  const lastVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instance.id })
    .orderBy('version_number', 'desc')
    .first();

  if (lastVersion) {
    await db('instance_versions').insert({
      tenant_id: tenantId,
      workflow_instance_id: newInstance.id,
      version_number: 1,
      file_path: lastVersion.file_path,
      uploaded_by: lastVersion.uploaded_by,
    });
  }

  return newInstance;
}
```

Update `module.exports` to:
```js
module.exports = {
  getInstanceDetail,
  startInstance,
  claimInstance,
  addInstanceVersion,
  getCurrentFilePath,
  forwardInstance,
  sendBackInstance,
  rejectInstance,
  resubmitInstance,
};
```

- [ ] **Step 4: Add the routes to `backend/src/routes/instances.js`**

Update the destructured import to include `rejectInstance` and `resubmitInstance`, then add before `module.exports = router;`:
```js
router.post('/:id/reject', async (req, res, next) => {
  try {
    const instance = await rejectInstance(req.user.tenantId, req.user.userId, req.params.id, req.body.comment);
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resubmit', async (req, res, next) => {
  try {
    const instance = await resubmitInstance(req.user.tenantId, req.user.userId, req.params.id);
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/instances.rejectAndResubmit.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/workflowInstanceService.js src/routes/instances.js tests/instances.rejectAndResubmit.test.js
git commit -m "feat: add hard reject and clone-after-reject resubmission"
```

---

## Task 8: Admin reassignment for stuck instances

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js` (add `reassignInstance`)
- Create: `backend/src/routes/admin/instances.js`
- Modify: `backend/src/app.js` (mount the router)
- Test: `backend/tests/instances.reassign.test.js`

**Interfaces:**
- Consumes: `getInstanceDetail`, `assertUuid`.
- Produces: `reassignInstance(tenantId, adminId, instanceId, targetUserId, comment) -> Promise<instance>`; `POST /admin/instances/:id/reassign`. Sets `claimed_by` on the single instance only — never touches the workflow template's stage definition.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.reassign.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'c6000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'c6000000-0000-0000-0000-000000000002';
const STUCK_USER = 'c6000000-0000-0000-0000-000000000003';
const REPLACEMENT_USER = 'c6000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const replacementToken = signToken({ sub: REPLACEMENT_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('admin reassignment', () => {
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Reassign Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'reassign-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STUCK_USER, tenant_id: TENANT_ID, email: 'reassign-stuck@example.com', password_hash: 'x' },
        { id: REPLACEMENT_USER, tenant_id: TENANT_ID, email: 'reassign-repl@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reassign Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reassign Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: STUCK_USER });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Reassign Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ documentTypeId: documentType.body.id });
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
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('lets an admin reassign the stuck instance to a replacement user, who can then act on it', async () => {
    const reassignResponse = await request(app)
      .post(`/admin/instances/${instanceId}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: REPLACEMENT_USER, comment: 'Original assignee is on leave' });
    expect(reassignResponse.status).toBe(200);
    expect(reassignResponse.body.claimed_by).toBe(REPLACEMENT_USER);

    const forwardResponse = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${replacementToken}`)
      .send({});
    expect(forwardResponse.status).toBe(200);
  });

  it('rejects reassignment from a non-admin', async () => {
    const response = await request(app)
      .post(`/admin/instances/${instanceId}/reassign`)
      .set('Authorization', `Bearer ${replacementToken}`)
      .send({ userId: REPLACEMENT_USER });
    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.reassign.test.js`
Expected: FAIL — route does not exist (404).

- [ ] **Step 3: Add `reassignInstance` to `backend/src/services/workflowInstanceService.js`**

Append before `module.exports`:
```js
async function reassignInstance(tenantId, adminId, instanceId, targetUserId, comment) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be reassigned');
  }

  assertUuid(targetUserId, 'userId');
  const targetUser = await db('users').where({ tenant_id: tenantId, id: targetUserId }).first();
  if (!targetUser) {
    throw new AppError(400, 'userId does not belong to this tenant');
  }

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ claimed_by: targetUserId })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'reassign',
    from_stage_order: instance.current_stage_order,
    to_stage_order: instance.current_stage_order,
    actor_id: adminId,
    comment: comment || null,
  });

  return updated;
}
```

Update `module.exports` to:
```js
module.exports = {
  getInstanceDetail,
  startInstance,
  claimInstance,
  addInstanceVersion,
  getCurrentFilePath,
  forwardInstance,
  sendBackInstance,
  rejectInstance,
  resubmitInstance,
  reassignInstance,
};
```

- [ ] **Step 4: Write `backend/src/routes/admin/instances.js`**

```js
const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { reassignInstance } = require('../../services/workflowInstanceService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post('/:id/reassign', async (req, res, next) => {
  try {
    const instance = await reassignInstance(
      req.user.tenantId,
      req.user.userId,
      req.params.id,
      req.body.userId,
      req.body.comment,
    );
    res.status(200).json(instance);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Mount the router in `backend/src/app.js`**

Add with the other route imports:
```js
const adminInstancesRouter = require('./routes/admin/instances');
```
Add after the `/instances` mount:
```js
app.use('/admin/instances', adminInstancesRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/instances.reassign.test.js`
Expected: PASS, all 2 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/services/workflowInstanceService.js src/routes/admin/instances.js src/app.js tests/instances.reassign.test.js
git commit -m "feat: add admin reassignment for stuck instances"
```

---

## Task 9: End-to-end exit-criteria verification

**Files:** none created — verification only.

- [ ] **Step 1: Run the full automated test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all suites pass (Phases 0-1's 44 tests + this phase's new tests).

- [ ] **Step 2: Walk a full multi-stage instance lifecycle via curl, using only API calls**

With the stack running, reuse the 3-stage workflow built in Phase 1's exit-criteria walkthrough (or build a fresh one), then:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@dev.local","password":"ChangeMe123!"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")

INSTANCE_ID=$(curl -s -X POST http://localhost:3000/instances -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"documentTypeId\":\"$DOCUMENT_TYPE_ID\"}" | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).id))")

curl -s http://localhost:3000/instances/$INSTANCE_ID/current-file -H "Authorization: Bearer $TOKEN" -o /tmp/downloaded.docx
curl -s -X POST http://localhost:3000/instances/$INSTANCE_ID/versions -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/downloaded.docx"
curl -s -X POST http://localhost:3000/instances/$INSTANCE_ID/forward -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"comment":"stage 1 done"}'
curl -s -X POST http://localhost:3000/instances/$INSTANCE_ID/send-back -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"comment":"needs rework"}'
curl -s -X POST http://localhost:3000/instances/$INSTANCE_ID/forward -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
curl -s -X POST http://localhost:3000/instances/$INSTANCE_ID/reject -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"comment":"final rejection"}'
curl -s -X POST http://localhost:3000/instances/$INSTANCE_ID/resubmit -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/instances/$INSTANCE_ID -H "Authorization: Bearer $TOKEN"
```

Expected: every call succeeds with correct state at each step — forward advances the stage, send-back returns exactly one stage, reject sets `status: "rejected"`, and resubmit produces a brand-new instance ID at stage 1 carrying the last saved file.

- [ ] **Step 3: Update `PROGRESS.md` with the Phase 2 completion summary and commit**

```bash
git add PROGRESS.md
git commit -m "docs: update progress log for Phase 2 completion"
```

## Phase 2 Exit Criteria (verify all before moving to Phase 3)

- [ ] A document can be walked through a full multi-stage workflow via API calls alone, including a send-back and a hard reject, with correct state at every step.
- [ ] Role-assigned stages require a claim (by a role-holder) before any action; user-assigned stages act directly.
- [ ] Every transition is authorization-checked against the current stage's assignee rules (`canAct`).
- [ ] Every transition (claim/forward/send_back/reject/reassign) is recorded in `stage_actions` with actor, timestamp, and optional comment.
- [ ] Admin reassignment updates only the single stuck instance, never the workflow template's stage definition.
- [ ] Resubmission after a hard reject clones the rejected instance's last saved version into a fresh instance at stage 1.
- [ ] Full test suite passes.
