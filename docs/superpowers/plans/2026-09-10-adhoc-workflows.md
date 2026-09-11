# Ad-Hoc Workflow Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a document type run without a fixed admin-predefined workflow — the user starting the instance builds the ordered stage list (people/groups from their visible pool) at creation time instead.

**Architecture:** An ad-hoc start creates a private, one-off `workflow_templates` + `workflow_stages` row set from the user's input, then stores the resulting template id directly on the new `workflow_instances` row. Every existing stage-progression function (`forward`, `send back`, `reject`, `claim`, notifications) is repointed to read the template id from the instance instead of from the document type, so no code path needs to branch on "is this ad-hoc?" — predefined and ad-hoc instances look identical to everything downstream of creation.

**Tech Stack:** Node.js/Express/Knex/PostgreSQL backend, React/TypeScript/Vite frontend, Jest+Supertest backend tests, `tsc -b` for frontend verification (no frontend test framework in this repo).

**Spec:** `docs/superpowers/specs/2026-09-10-adhoc-workflows-design.md`

## Global Constraints

- Ad-hoc stage assignee types are `'user'` and `'group'` only — never `'role'` (spec §2, §6).
- Ad-hoc stages always get `allowed_actions: ['forward', 'send_back', 'reject']` — no per-stage action configuration in this feature (spec §3).
- `document_types.workflow_mode` defaults to `'predefined'`; existing rows must backfill to `'predefined'` with their existing `workflow_template_id` untouched (spec §2).
- Mode is fixed at document-type creation — no editing an existing document type's mode (spec §6).
- No changes to `AdminInstancesPage`/`listInstancesForAdmin` — it already works unmodified (spec §6).
- Every backend change must keep the full existing test suite passing (regression safety net for repointing stage resolution from `documentType.workflow_template_id` to `instance.workflow_template_id`).

---

## Task 1: Migration — ad-hoc workflow mode schema

**Files:**
- Create: `backend/migrations/015_add_adhoc_workflow_mode.js`
- Test: `backend/tests/adhocWorkflowMode.schema.test.js`

**Interfaces:**
- Produces: `document_types.workflow_mode` (enum `'predefined' | 'adhoc'`, not null, default `'predefined'`), `document_types.workflow_template_id` (now nullable), `workflow_instances.workflow_template_id` (uuid, not null, FK to `workflow_templates(tenant_id, id)`, backfilled from `document_types.workflow_template_id` for existing rows).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/adhocWorkflowMode.schema.test.js
const db = require('../src/config/db');

describe('ad-hoc workflow mode schema', () => {
  afterAll(async () => {
    await db.destroy();
  });

  it('adds workflow_mode to document_types, defaulting to predefined', async () => {
    const hasColumn = await db.schema.hasColumn('document_types', 'workflow_mode');
    expect(hasColumn).toBe(true);

    const columnInfo = await db('document_types').columnInfo();
    expect(columnInfo.workflow_mode.nullable).toBe(false);
    expect(String(columnInfo.workflow_template_id.nullable)).toBe('true');
  });

  it('adds a not-null workflow_template_id column to workflow_instances', async () => {
    const hasColumn = await db.schema.hasColumn('workflow_instances', 'workflow_template_id');
    expect(hasColumn).toBe(true);

    const columnInfo = await db('workflow_instances').columnInfo();
    expect(columnInfo.workflow_template_id.nullable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && cross-env NODE_ENV=test npx jest tests/adhocWorkflowMode.schema.test.js`
Expected: FAIL — `hasColumn` returns `false` (migration 015 doesn't exist yet).

- [ ] **Step 3: Write the migration**

```js
// backend/migrations/015_add_adhoc_workflow_mode.js
exports.up = async function up(knex) {
  await knex.raw("CREATE TYPE document_type_workflow_mode AS ENUM ('predefined', 'adhoc')");

  await knex.schema.alterTable('document_types', (table) => {
    table
      .specificType('workflow_mode', 'document_type_workflow_mode')
      .notNullable()
      .defaultTo('predefined');
  });

  // Postgres composite FKs use MATCH SIMPLE by default: a row is exempt from
  // the constraint if ANY column in the FK is NULL, so relaxing this column
  // to nullable does not require touching the existing
  // (tenant_id, workflow_template_id) -> workflow_templates(tenant_id, id) FK.
  await knex.schema.alterTable('document_types', (table) => {
    table.uuid('workflow_template_id').nullable().alter();
  });

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.uuid('workflow_template_id');
  });

  // Backfill every existing instance from its document type's (until-now
  // fixed) workflow template, since all existing rows are implicitly
  // 'predefined' (the enum default set above).
  await knex.raw(`
    UPDATE workflow_instances wi
    SET workflow_template_id = dt.workflow_template_id
    FROM document_types dt
    WHERE dt.id = wi.document_type_id
      AND dt.tenant_id = wi.tenant_id
      AND wi.workflow_template_id IS NULL
  `);

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.uuid('workflow_template_id').notNullable().alter();
    table
      .foreign(['tenant_id', 'workflow_template_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_templates');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_instances', (table) => {
    table.dropForeign(['tenant_id', 'workflow_template_id']);
    table.dropColumn('workflow_template_id');
  });
  await knex.schema.alterTable('document_types', (table) => {
    table.uuid('workflow_template_id').notNullable().alter();
    table.dropColumn('workflow_mode');
  });
  await knex.raw('DROP TYPE IF EXISTS document_type_workflow_mode');
};
```

- [ ] **Step 4: Run migrations and the test again to verify it passes**

Run: `cd backend && cross-env NODE_ENV=test npx knex migrate:latest && cross-env NODE_ENV=test npx jest tests/adhocWorkflowMode.schema.test.js`
Expected: PASS (both `it` blocks).

- [ ] **Step 5: Run the full existing suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all 43 existing suites plus this new one, 160+ tests total.

- [ ] **Step 6: Apply the migration to the dev database too**

Run: `cd backend && npx knex migrate:latest`
Expected: `Batch N run: 1 migrations` (dev DB now matches test DB schema).

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/015_add_adhoc_workflow_mode.js backend/tests/adhocWorkflowMode.schema.test.js
git commit -m "feat: add ad-hoc workflow mode schema (document type mode + instance template pointer)"
```

---

## Task 2: `documentTypeService` — workflow mode validation

**Files:**
- Modify: `backend/src/services/documentTypeService.js`
- Test: `backend/tests/documentTypes.test.js`

**Interfaces:**
- Consumes: `document_types.workflow_mode`/nullable `workflow_template_id` (Task 1).
- Produces: `createDocumentType(tenantId, { name, templateFileId, workflowMode?, workflowTemplateId?, allowedExtensions?, maxUploadSizeBytes? })` — `workflowMode` defaults to `'predefined'`; when `'predefined'`, `workflowTemplateId` is required and validated as before; when `'adhoc'`, `workflowTemplateId` must be omitted and the stored `workflow_template_id` is `null`. Returned document type rows always include `workflow_mode`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/documentTypes.test.js` (inside the existing `describe` block, after the existing `it`):

```js
  it('creates an ad-hoc document type with no workflow template', async () => {
    const response = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ad-hoc Memo', templateFileId, workflowMode: 'adhoc' });
    expect(response.status).toBe(201);
    expect(response.body.workflow_mode).toBe('adhoc');
    expect(response.body.workflow_template_id).toBeNull();
  });

  it('rejects a predefined document type with no workflow template', async () => {
    const response = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Broken Predefined', templateFileId });
    expect(response.status).toBe(400);
  });

  it('rejects an ad-hoc document type that also supplies a workflow template', async () => {
    const response = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Broken Adhoc', templateFileId, workflowMode: 'adhoc', workflowTemplateId });
    expect(response.status).toBe(400);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && cross-env NODE_ENV=test npx jest tests/documentTypes.test.js`
Expected: FAIL — the first new test gets a 400 (service still requires `workflowTemplateId` unconditionally); the second and third don't fail yet but will once behavior changes, so re-check after Step 4, not before — for now confirm the ad-hoc-creation test fails.

- [ ] **Step 3: Implement workflow mode validation**

Replace the top of `backend/src/services/documentTypeService.js`:

```js
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');

const DEFAULT_ALLOWED_EXTENSIONS = ['docx'];
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const WORKFLOW_MODES = ['predefined', 'adhoc'];

async function assertBelongsToTenant(tenantId, table, id, label) {
  assertUuid(id, label);
  const row = await db(table).where({ tenant_id: tenantId, id }).first();
  if (!row) {
    throw new AppError(400, `${label} does not belong to this tenant`);
  }
}

async function createDocumentType(tenantId, input) {
  const { name, templateFileId, workflowMode, workflowTemplateId, allowedExtensions, maxUploadSizeBytes } = input;
  assertRequiredString(name, 'name');
  await assertBelongsToTenant(tenantId, 'template_files', templateFileId, 'templateFileId');

  const mode = workflowMode === undefined ? 'predefined' : workflowMode;
  if (!WORKFLOW_MODES.includes(mode)) {
    throw new AppError(400, `workflowMode must be one of: ${WORKFLOW_MODES.join(', ')}`);
  }

  let resolvedWorkflowTemplateId = null;
  if (mode === 'predefined') {
    await assertBelongsToTenant(tenantId, 'workflow_templates', workflowTemplateId, 'workflowTemplateId');
    resolvedWorkflowTemplateId = workflowTemplateId;
  } else if (workflowTemplateId !== undefined && workflowTemplateId !== null) {
    throw new AppError(400, 'workflowTemplateId must not be provided when workflowMode is "adhoc"');
  }

  const [documentType] = await db('document_types')
    .insert({
      tenant_id: tenantId,
      name,
      template_file_id: templateFileId,
      workflow_mode: mode,
      workflow_template_id: resolvedWorkflowTemplateId,
      allowed_extensions: JSON.stringify(
        Array.isArray(allowedExtensions) && allowedExtensions.length > 0
          ? allowedExtensions
          : DEFAULT_ALLOWED_EXTENSIONS,
      ),
      max_upload_size_bytes:
        Number.isInteger(maxUploadSizeBytes) && maxUploadSizeBytes > 0
          ? maxUploadSizeBytes
          : DEFAULT_MAX_UPLOAD_SIZE_BYTES,
    })
    .returning('*');

  return documentType;
}
```

Leave `listDocumentTypes`, `getDocumentType`, `updateDocumentType`, `deleteDocumentType`, and the final `module.exports` block exactly as they are — `workflow_mode` flows through automatically since none of them use an explicit column list.

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `cd backend && cross-env NODE_ENV=test npx jest tests/documentTypes.test.js`
Expected: PASS — all `it` blocks, including the pre-existing ones.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/documentTypeService.js backend/tests/documentTypes.test.js
git commit -m "feat: let a document type be created in ad-hoc workflow mode"
```

---

## Task 3: `workflowInstanceService` — ad-hoc start and instance-driven stage resolution

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js`
- Test: Create `backend/tests/instances.adhoc.test.js`

**Interfaces:**
- Consumes: `documentTypeService`'s `workflow_mode`/nullable `workflow_template_id` (Task 2), `workflow_instances.workflow_template_id` column (Task 1).
- Produces: `startInstance(tenantId, userId, documentTypeId, stages)` — `stages` is `Array<{ name: string, assigneeType: 'user'|'group', assigneeId: string }> | undefined`, required (non-empty) exactly when the document type is `'adhoc'`, rejected (400) when provided for a `'predefined'` type. `getInstanceDetail`, `forwardInstance`, `sendBackInstance` now resolve the current/next/previous stage via `instance.workflow_template_id` instead of `documentType.workflow_template_id`. `resubmitInstance` copies `workflow_template_id` onto the new instance.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/instances.adhoc.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'd0000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'd0000000-0000-0000-0000-000000000002';
const REVIEWER_ID = 'd0000000-0000-0000-0000-000000000003';
const GROUP_MEMBER_ID = 'd0000000-0000-0000-0000-000000000004';
const OUTSIDER_ID = 'd0000000-0000-0000-0000-000000000005';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const reviewerToken = signToken({ sub: REVIEWER_ID, tenant_id: TENANT_ID, is_admin: false });
const groupMemberToken = signToken({ sub: GROUP_MEMBER_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('ad-hoc workflow instances', () => {
  let adhocDocumentTypeId;
  let groupId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Adhoc Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'adhoc-admin@example.com', password_hash: 'x', is_admin: true },
        { id: REVIEWER_ID, tenant_id: TENANT_ID, email: 'adhoc-reviewer@example.com', password_hash: 'x' },
        { id: GROUP_MEMBER_ID, tenant_id: TENANT_ID, email: 'adhoc-groupmember@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'adhoc-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const group = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Adhoc Finance Group' });
    groupId = group.body.id;
    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: GROUP_MEMBER_ID });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Adhoc Memo Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Adhoc Memo', templateFileId: templateFile.body.id, workflowMode: 'adhoc' });
    adhocDocumentTypeId = documentType.body.id;
  });

  afterAll(async () => {
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('instance_versions').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects starting an ad-hoc instance with no stages', async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ documentTypeId: adhocDocumentTypeId });
    expect(response.status).toBe(400);
  });

  it('rejects a stage assigneeId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        documentTypeId: adhocDocumentTypeId,
        stages: [{ name: 'Review', assigneeType: 'user', assigneeId: '00000000-0000-0000-0000-000000000099' }],
      });
    expect(response.status).toBe(400);
  });

  it('builds a private workflow template and progresses through it like a predefined one', async () => {
    const startResponse = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        documentTypeId: adhocDocumentTypeId,
        stages: [
          { name: 'Reviewer sign-off', assigneeType: 'user', assigneeId: REVIEWER_ID },
          { name: 'Finance sign-off', assigneeType: 'group', assigneeId: groupId },
        ],
      });
    expect(startResponse.status).toBe(201);
    const instanceId = startResponse.body.id;
    expect(startResponse.body.workflow_template_id).toBeTruthy();

    const detailResponse = await request(app)
      .get(`/instances/${instanceId}`)
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(detailResponse.body.currentStage.name).toBe('Reviewer sign-off');
    expect(detailResponse.body.currentStage.assignee_user_id).toBe(REVIEWER_ID);

    const forwardResponse = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({});
    expect(forwardResponse.status).toBe(200);
    expect(forwardResponse.body.current_stage_order).toBe(2);

    const outsiderClaim = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(outsiderClaim.status).toBe(403);

    const claimResponse = await request(app)
      .post(`/instances/${instanceId}/claim`)
      .set('Authorization', `Bearer ${groupMemberToken}`);
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.body.claimed_by).toBe(GROUP_MEMBER_ID);

    const rejectResponse = await request(app)
      .post(`/instances/${instanceId}/reject`)
      .set('Authorization', `Bearer ${groupMemberToken}`)
      .send({ comment: 'Missing figures' });
    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body.status).toBe('rejected');

    const resubmitResponse = await request(app)
      .post(`/instances/${instanceId}/resubmit`)
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(resubmitResponse.status).toBe(201);
    expect(resubmitResponse.body.workflow_template_id).toBe(startResponse.body.workflow_template_id);
  });

  it('surfaces the ad-hoc instance under my-tasks for the assigned reviewer', async () => {
    const myTasksResponse = await request(app)
      .get('/instances/my-tasks')
      .set('Authorization', `Bearer ${reviewerToken}`);
    expect(myTasksResponse.status).toBe(200);
    const allTasks = [...myTasksResponse.body.assignedToMe, ...myTasksResponse.body.waitingOnOthers];
    const adhocTask = allTasks.find((task) => task.document_type_name === 'Adhoc Memo');
    expect(adhocTask).toBeTruthy();
    expect(adhocTask.currentStage).toBeTruthy();
    expect(adhocTask.currentStage.name).toBe('Reviewer sign-off');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && cross-env NODE_ENV=test npx jest tests/instances.adhoc.test.js`
Expected: FAIL — `startInstance` doesn't accept `stages` yet and unconditionally uses `documentType.workflow_template_id` (null for this ad-hoc type), so the first real request already errors differently than expected.

- [ ] **Step 3: Implement**

In `backend/src/services/workflowInstanceService.js`, update the import line and add the ad-hoc template builder plus rewire the four functions that resolve stages:

```js
const path = require('path');
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');
const { canAct } = require('../utils/workflowAuthorization');
const { assertAllowedUpload } = require('../utils/fileValidation');
const { saveUploadedFile, STORAGE_ROOT } = require('./fileStorageService');
const { notifyStage, notifyUser } = require('./notificationService');

const ADHOC_ASSIGNEE_TYPES = ['user', 'group'];
const ADHOC_DEFAULT_ALLOWED_ACTIONS = ['forward', 'send_back', 'reject'];

async function createAdhocWorkflowTemplate(tenantId, documentType, stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new AppError(400, 'stages must be a non-empty array for an ad-hoc document type');
  }

  const validatedStages = [];
  for (const rawStage of stages) {
    const stage = rawStage || {};
    assertRequiredString(stage.name, 'stages[].name');
    if (!ADHOC_ASSIGNEE_TYPES.includes(stage.assigneeType)) {
      throw new AppError(400, `stages[].assigneeType must be one of: ${ADHOC_ASSIGNEE_TYPES.join(', ')}`);
    }
    assertUuid(stage.assigneeId, 'stages[].assigneeId');
    const table = stage.assigneeType === 'user' ? 'users' : 'groups';
    const row = await db(table).where({ tenant_id: tenantId, id: stage.assigneeId }).first();
    if (!row) {
      throw new AppError(400, `stages[].assigneeId does not belong to this tenant (${stage.assigneeType})`);
    }
    validatedStages.push({ name: stage.name, assigneeType: stage.assigneeType, assigneeId: stage.assigneeId });
  }

  return db.transaction(async (trx) => {
    const [workflowTemplate] = await trx('workflow_templates')
      .insert({
        tenant_id: tenantId,
        name: `${documentType.name} (ad-hoc, started ${new Date().toISOString()})`,
      })
      .returning('*');

    await trx('workflow_stages').insert(
      validatedStages.map((stage, index) => ({
        tenant_id: tenantId,
        workflow_template_id: workflowTemplate.id,
        stage_order: index + 1,
        name: stage.name,
        assignee_type: stage.assigneeType,
        assignee_user_id: stage.assigneeType === 'user' ? stage.assigneeId : null,
        assignee_group_id: stage.assigneeType === 'group' ? stage.assigneeId : null,
        allowed_actions: JSON.stringify(ADHOC_DEFAULT_ALLOWED_ACTIONS),
      })),
    );

    return workflowTemplate.id;
  });
}

async function getInstanceDetail(tenantId, instanceId) {
  assertUuid(instanceId, 'instanceId');
  const instance = await db('workflow_instances').where({ tenant_id: tenantId, id: instanceId }).first();
  if (!instance) {
    throw new AppError(404, 'Workflow instance not found');
  }

  const documentType = await db('document_types')
    .where({ tenant_id: tenantId, id: instance.document_type_id })
    .first();

  const templateFile = await db('template_files')
    .where({ tenant_id: tenantId, id: documentType.template_file_id })
    .first();
  documentType.content_format = templateFile.content_format;

  const stage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: instance.workflow_template_id,
      stage_order: instance.current_stage_order,
    })
    .first();

  return { instance, documentType, stage };
}

async function startInstance(tenantId, userId, documentTypeId, stages) {
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

  let workflowTemplateId;
  if (documentType.workflow_mode === 'adhoc') {
    workflowTemplateId = await createAdhocWorkflowTemplate(tenantId, documentType, stages);
  } else {
    if (stages !== undefined) {
      throw new AppError(400, 'stages must not be provided for a predefined-workflow document type');
    }
    workflowTemplateId = documentType.workflow_template_id;
  }

  const firstStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId, stage_order: 1 })
    .first();
  if (!firstStage) {
    throw new AppError(400, 'The linked workflow template has no stages configured yet');
  }

  const [instance] = await db('workflow_instances')
    .insert({
      tenant_id: tenantId,
      document_type_id: documentTypeId,
      template_file_version_id: latestTemplateVersion.id,
      workflow_template_id: workflowTemplateId,
      current_stage_order: 1,
      status: 'in_progress',
      created_by: userId,
    })
    .returning('*');

  await notifyStage(tenantId, instance.id, 'assigned', firstStage, {
    documentTypeName: documentType.name,
    stageName: firstStage.name,
  });

  return instance;
}
```

Then, further down in the same file, in `forwardInstance` change:

```js
  const nextStage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: instance.workflow_template_id,
      stage_order: instance.current_stage_order + 1,
    })
    .first();
```

(was `workflow_template_id: documentType.workflow_template_id`).

In `sendBackInstance` change:

```js
  const targetStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: instance.workflow_template_id, stage_order: targetStageOrder })
    .first();
```

(was `workflow_template_id: documentType.workflow_template_id`).

In `resubmitInstance`, add `workflow_template_id` to the copied insert:

```js
  const [newInstance] = await db('workflow_instances')
    .insert({
      tenant_id: tenantId,
      document_type_id: instance.document_type_id,
      template_file_version_id: instance.template_file_version_id,
      workflow_template_id: instance.workflow_template_id,
      current_stage_order: 1,
      status: 'in_progress',
      created_by: userId,
    })
    .returning('*');
```

Finally, update `backend/src/routes/instances.js`'s `POST /` handler to pass `stages` through:

```js
router.post('/', async (req, res, next) => {
  try {
    const instance = await startInstance(req.user.tenantId, req.user.userId, req.body.documentTypeId, req.body.stages);
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Fix `dashboardService.listMyTasks`'s now-conflicting select**

`listMyTasks` currently selects both `workflow_instances.*` and `document_types.workflow_template_id` — now that `workflow_instances` has its own `workflow_template_id` column, that second explicit column silently overwrites the instance's own value with the document type's (which is `null` for an ad-hoc type), breaking the stage lookup a few lines below. In `backend/src/services/dashboardService.js`, change:

```js
  const inProgress = await db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where({ 'workflow_instances.tenant_id': tenantId, 'workflow_instances.status': 'in_progress' })
    .select(
      'workflow_instances.*',
      'document_types.name as document_type_name',
    );
```

(removes the `'document_types.workflow_template_id'` line — `workflow_instances.*` already carries the correct per-instance value).

- [ ] **Step 5: Run the new test to verify it passes**

Run: `cd backend && cross-env NODE_ENV=test npx jest tests/instances.adhoc.test.js`
Expected: PASS — all 4 `it` blocks.

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — every existing predefined-flow test (claim, forward, send-back, reject, resubmit, my-tasks, notifications) still passes unchanged, confirming the `documentType.workflow_template_id` → `instance.workflow_template_id` switch is behavior-preserving for predefined instances.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/workflowInstanceService.js backend/src/services/dashboardService.js backend/src/routes/instances.js backend/tests/instances.adhoc.test.js
git commit -m "feat: start ad-hoc workflow instances with a user-built stage list"
```

---

## Task 4: Frontend API layer

**Files:**
- Modify: `frontend/src/api/documentTypes.ts`
- Modify: `frontend/src/api/instances.ts`
- Modify: `frontend/src/api/users.ts`
- Modify: `frontend/src/api/groups.ts`

**Interfaces:**
- Consumes: backend fields/endpoints from Tasks 1-3 (`workflow_mode`, `workflow_template_id`, `GET /users/visible`, `GET /groups/visible`).
- Produces: `VisibleUser`, `VisibleGroup` types and `listVisibleUsers()`/`listVisibleGroups()` functions consumed by Task 6's stage builder. `AdhocStageInput` type and updated `startInstance` signature consumed by the same.

- [ ] **Step 1: Update `documentTypes.ts`**

```ts
import { apiFetch } from './client';

export type WorkflowMode = 'predefined' | 'adhoc';

export interface DocumentType {
  id: string;
  name: string;
  template_file_id: string;
  workflow_mode: WorkflowMode;
  workflow_template_id: string | null;
  allowed_extensions: string[];
  max_upload_size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentTypeInput {
  name: string;
  templateFileId: string;
  workflowMode?: WorkflowMode;
  workflowTemplateId?: string;
  allowedExtensions?: string[];
  maxUploadSizeBytes?: number;
}

export function listDocumentTypes(): Promise<DocumentType[]> {
  return apiFetch('/admin/document-types');
}

export function createDocumentType(input: DocumentTypeInput): Promise<DocumentType> {
  return apiFetch('/admin/document-types', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDocumentType(id: string, input: Partial<DocumentTypeInput>): Promise<DocumentType> {
  return apiFetch(`/admin/document-types/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteDocumentType(id: string): Promise<void> {
  return apiFetch(`/admin/document-types/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Update `instances.ts`**

In `frontend/src/api/instances.ts`, add `workflow_template_id: string;` to the `WorkflowInstance` interface (after `document_type_id`), add `workflow_mode: 'predefined' | 'adhoc';` to `StartableDocumentType`, and replace the `startInstance` export:

```ts
export interface AdhocStageInput {
  name: string;
  assigneeType: 'user' | 'group';
  assigneeId: string;
}

export function startInstance(documentTypeId: string, stages?: AdhocStageInput[]): Promise<WorkflowInstance> {
  return apiFetch('/instances', { method: 'POST', body: JSON.stringify({ documentTypeId, stages }) });
}
```

- [ ] **Step 3: Update `users.ts`**

```ts
export interface VisibleUser {
  id: string;
  email: string;
  full_name: string | null;
}

export function listVisibleUsers(): Promise<VisibleUser[]> {
  return apiFetch('/users/visible');
}
```

(append below the existing `listUsers` export; keep the existing `AdminUser`/`listUsers` untouched — admin screens keep using the unrestricted list).

- [ ] **Step 4: Update `groups.ts`**

```ts
export interface VisibleGroup {
  id: string;
  name: string;
}

export function listVisibleGroups(): Promise<VisibleGroup[]> {
  return apiFetch('/groups/visible');
}
```

(append below the existing `listGroups` export).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no output (clean compile). If it errors, it will point at a call site still using the old `startInstance(documentTypeId)` single-arg signature or the old required `workflowTemplateId` — that's expected to still compile since the new params are optional; investigate any real mismatch before proceeding.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/documentTypes.ts frontend/src/api/instances.ts frontend/src/api/users.ts frontend/src/api/groups.ts
git commit -m "feat: add frontend API types for ad-hoc workflow mode and visibility-scoped pickers"
```

---

## Task 5: Admin UI — document type workflow mode toggle

**Files:**
- Modify: `frontend/src/pages/admin/DocumentTypesPage.tsx`

**Interfaces:**
- Consumes: `WorkflowMode`, updated `DocumentType`/`DocumentTypeInput` (Task 4).

- [ ] **Step 1: Implement the mode toggle**

Change the `documentTypes` import line at the top of `DocumentTypesPage.tsx` to also bring in `WorkflowMode` (every other import stays exactly as it is):

```tsx
import {
  createDocumentType,
  deleteDocumentType,
  listDocumentTypes,
  updateDocumentType,
  WorkflowMode,
} from '../../api/documentTypes';
```

Then update the component body:

```tsx
export function DocumentTypesPage() {
  const queryClient = useQueryClient();
  const { data: documentTypes, isLoading } = useQuery({ queryKey: ['documentTypes'], queryFn: listDocumentTypes });
  const { data: templateFiles } = useQuery({ queryKey: ['templateFiles'], queryFn: listTemplateFiles });
  const { data: workflowTemplates } = useQuery({ queryKey: ['workflowTemplates'], queryFn: listWorkflowTemplates });

  const [name, setName] = useState('');
  const [templateFileId, setTemplateFileId] = useState('');
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('predefined');
  const [workflowTemplateId, setWorkflowTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['documentTypes'] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createDocumentType({
        name,
        templateFileId,
        workflowMode,
        workflowTemplateId: workflowMode === 'predefined' ? workflowTemplateId : undefined,
      }),
    onSuccess: () => {
      setName('');
      setTemplateFileId('');
      setWorkflowMode('predefined');
      setWorkflowTemplateId('');
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create document type'),
  });
```

Leave `updateMutation`, `deleteMutation`, `startEditing`, `saveEdit` unchanged. In `handleCreate`, no change is needed (it already just calls `createMutation.mutate()`).

In the JSX, replace the "Workflow template" `<label>` block with a mode radio followed by a conditional template picker:

```tsx
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={workflowMode === 'predefined'}
              onChange={() => setWorkflowMode('predefined')}
            />
            Predefined workflow
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={workflowMode === 'adhoc'} onChange={() => setWorkflowMode('adhoc')} />
            Users define the workflow when they start it
          </label>
        </div>
        {workflowMode === 'predefined' && (
          <label className="block text-sm">
            Workflow template
            <select
              required
              value={workflowTemplateId}
              onChange={(e) => setWorkflowTemplateId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a workflow template</option>
              {workflowTemplates?.map((wt) => (
                <option key={wt.id} value={wt.id}>
                  {wt.name}
                </option>
              ))}
            </select>
          </label>
        )}
```

And in the list rendering, show the mode next to each document type's name:

```tsx
            {editingId === documentType.id ? (
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="mr-2 flex-1 rounded border border-gray-300 px-2 py-1"
              />
            ) : (
              <span>
                {documentType.name}{' '}
                <span className="text-xs text-gray-500">
                  ({documentType.workflow_mode === 'adhoc' ? 'ad-hoc' : 'predefined'})
                </span>
              </span>
            )}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no output (clean compile).

- [ ] **Step 3: Manual verification**

With both dev servers running, open `/admin/document-types` in the browser, create a document type choosing "Users define the workflow when they start it" (no template picker should appear), confirm it's created and the list shows "(ad-hoc)" next to its name, then create a second one as "Predefined workflow" and confirm the existing behavior (template picker required, list shows "(predefined)") is unchanged.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/DocumentTypesPage.tsx
git commit -m "feat: let admins mark a document type as ad-hoc workflow"
```

---

## Task 6: End-user UI — ad-hoc stage builder on "Start a Document"

**Files:**
- Modify: `frontend/src/pages/NewInstancePage.tsx`

**Interfaces:**
- Consumes: `listStartableDocumentTypes` (now returns `workflow_mode`), `listVisibleUsers`/`listVisibleGroups` (Task 4), `startInstance(documentTypeId, stages?)` (Task 4).

- [ ] **Step 1: Implement the stage builder**

Replace the full contents of `frontend/src/pages/NewInstancePage.tsx`:

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AdhocStageInput, listStartableDocumentTypes, startInstance } from '../api/instances';
import { listVisibleUsers } from '../api/users';
import { listVisibleGroups } from '../api/groups';
import { ApiError } from '../api/client';

interface StageRow {
  name: string;
  assigneeType: 'user' | 'group';
  assigneeId: string;
}

function emptyRow(): StageRow {
  return { name: '', assigneeType: 'user', assigneeId: '' };
}

export function NewInstancePage() {
  const navigate = useNavigate();
  const { data: documentTypes, isLoading } = useQuery({
    queryKey: ['startableDocumentTypes'],
    queryFn: listStartableDocumentTypes,
  });
  const { data: visibleUsers } = useQuery({ queryKey: ['visibleUsers'], queryFn: listVisibleUsers });
  const { data: visibleGroups } = useQuery({ queryKey: ['visibleGroups'], queryFn: listVisibleGroups });

  const [documentTypeId, setDocumentTypeId] = useState('');
  const [stageRows, setStageRows] = useState<StageRow[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);

  const selectedDocumentType = documentTypes?.find((dt) => dt.id === documentTypeId);
  const isAdhoc = selectedDocumentType?.workflow_mode === 'adhoc';

  const startMutation = useMutation({
    mutationFn: () => {
      const stages: AdhocStageInput[] | undefined = isAdhoc
        ? stageRows.map((row) => ({ name: row.name, assigneeType: row.assigneeType, assigneeId: row.assigneeId }))
        : undefined;
      return startInstance(documentTypeId, stages);
    },
    onSuccess: (instance) => navigate(`/instances/${instance.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to start document'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startMutation.mutate();
  }

  function updateRow(index: number, patch: Partial<StageRow>) {
    setStageRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setStageRows((rows) => [...rows, emptyRow()]);
  }

  function removeRow(index: number) {
    setStageRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
  }

  const canSubmit =
    Boolean(documentTypeId) &&
    (!isAdhoc || stageRows.every((row) => row.name.trim().length > 0 && row.assigneeId.length > 0));

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Start a Document</h1>

      {isLoading && <p className="text-sm text-gray-500">Loading document types...</p>}

      <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          Document type
          <select
            required
            value={documentTypeId}
            onChange={(e) => {
              setDocumentTypeId(e.target.value);
              setStageRows([emptyRow()]);
            }}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">Select a document type</option>
            {documentTypes?.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.name}
              </option>
            ))}
          </select>
        </label>

        {isAdhoc && (
          <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-700">Build the approval steps</p>
            {stageRows.map((row, index) => (
              <div key={index} className="space-y-2 rounded border border-gray-200 bg-white p-2">
                <label className="block text-xs">
                  Stage {index + 1} name
                  <input
                    type="text"
                    required
                    value={row.name}
                    onChange={(e) => updateRow(index, { name: e.target.value })}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <div className="flex gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={row.assigneeType === 'user'}
                      onChange={() => updateRow(index, { assigneeType: 'user', assigneeId: '' })}
                    />
                    Person
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={row.assigneeType === 'group'}
                      onChange={() => updateRow(index, { assigneeType: 'group', assigneeId: '' })}
                    />
                    Group
                  </label>
                </div>
                <select
                  required
                  value={row.assigneeId}
                  onChange={(e) => updateRow(index, { assigneeId: e.target.value })}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">
                    {row.assigneeType === 'user' ? 'Select a person' : 'Select a group'}
                  </option>
                  {row.assigneeType === 'user'
                    ? visibleUsers?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email}
                        </option>
                      ))
                    : visibleGroups?.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                </select>
                {stageRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-xs text-red-700 hover:underline"
                  >
                    Remove stage
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRow} className="text-sm text-blue-700 hover:underline">
              + Add stage
            </button>
          </div>
        )}

        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={startMutation.isPending || !canSubmit}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Start
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no output (clean compile).

- [ ] **Step 3: Manual verification**

With both dev servers running: log in as a non-admin user, go to "Start a Document", pick the ad-hoc document type created in Task 5, add two stages (one assigned to a visible person, one to a visible group), submit, and confirm you land on the new instance's detail page showing "Stage: <first stage name>". Then forward it and confirm it moves to the second stage, and that a member of the assigned group can claim it (matching the backend test from Task 3). Also confirm picking a predefined document type still shows no stage builder and starts exactly as before.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/NewInstancePage.tsx
git commit -m "feat: let users build an ad-hoc workflow's stages when starting a document"
```
