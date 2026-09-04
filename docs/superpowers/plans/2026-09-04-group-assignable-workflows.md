# Group-Assignable Predefined Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin assign a predefined workflow stage to a group (not just a user or role), with claim semantics identical to role-assigned stages, correct "my tasks" surfacing, correct group-wide notifications, and a deletion guard preventing a group from being deleted while still assigned to a stage.

**Architecture:** Every change mirrors the existing role-assignment code path exactly — same files, same functions, one more `if`/`else if` branch or one more query per file. No new tables, no new endpoints, no new services. The only schema change is a Postgres native-enum addition plus one nullable FK column on `workflow_stages`.

**Tech Stack:** Node.js/Express, Knex (PostgreSQL), Jest + Supertest (backend tests). React + Vite + TypeScript + Tailwind, TanStack Query (frontend, no automated tests — manual browser verification).

**Spec:** `docs/superpowers/specs/2026-09-04-group-assignable-workflows-design.md`

## Global Constraints

- Every query scoped by `tenant_id` from the verified JWT (`req.user.tenantId`) — never a client-supplied value.
- All DB access via Knex query builder; no string-built SQL except the two `ALTER TYPE` statements this plan requires (Knex has no schema-builder API for adding an enum value), issued via `knex.raw`.
- UUID-shaped inputs validated with `assertUuid` before use.
- Error shape is always `{ error: string }`, thrown as `new AppError(statusCode, message)`.
- No automated frontend tests in this project — verify frontend changes by running `npm run build` (tsc -b && vite build) and, where feasible, the dev server in a browser.
- Backend tests run via `npm test` in `backend/`; `pretest` runs `knex migrate:latest` against the test DB automatically.

---

## Task 1: Migration — `assignee_type` enum + `assignee_group_id` column

**Files:**
- Create: `backend/migrations/014_add_group_assignable_stages.js`

**Interfaces:**
- Produces: `assignee_type` enum gains a third value `'group'`; `workflow_stages.assignee_group_id` (nullable uuid, composite FK `(tenant_id, assignee_group_id)` → `groups(tenant_id, id)`).

- [ ] **Step 1: Write the migration**

```javascript
exports.up = async function up(knex) {
  // Postgres forbids using a newly-added enum value in the same transaction
  // that added it — this migration only adds the value and the column; no
  // DML anywhere in this file references 'group', so it's safe to run
  // together and the value is usable by the next request after this
  // migration commits.
  await knex.raw("ALTER TYPE assignee_type ADD VALUE IF NOT EXISTS 'group'");

  await knex.schema.alterTable('workflow_stages', (table) => {
    table.uuid('assignee_group_id');
    table
      .foreign(['tenant_id', 'assignee_group_id'])
      .references(['tenant_id', 'id'])
      .inTable('groups');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_stages', (table) => {
    table.dropForeign(['tenant_id', 'assignee_group_id']);
    table.dropColumn('assignee_group_id');
  });
  // Postgres has no DROP VALUE for enums; removing 'group' from the type
  // would require rebuilding the enum (create new type, migrate column,
  // drop old type) and is not attempted here — down migrations in this
  // project are for local development rollback, not production reversal,
  // and a stray unused enum value is harmless.
};
```

- [ ] **Step 2: Run the migration against the dev DB**

Run (from `backend/`): `npm run migrate`
Expected: `Batch N run: 1 migrations` including `014_add_group_assignable_stages.js`, no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/014_add_group_assignable_stages.js
git commit -m "feat: add group as a workflow stage assignee type"
```

---

## Task 2: Admin API — `addWorkflowStage` accepts `assigneeType: 'group'`

**Files:**
- Modify: `backend/src/services/workflowTemplateService.js`
- Test: `backend/tests/workflowStages.test.js`

**Interfaces:**
- Consumes: `groups` table (existing, from sub-project 1).
- Produces: `addWorkflowStage(tenantId, workflowTemplateId, input)` now accepts `input.assigneeType === 'group'` with `input.assigneeGroupId`, validated the same way as `assigneeRoleId`, and inserts `assignee_group_id` on the stage row (leaving `assignee_user_id`/`assignee_role_id` null).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/workflowStages.test.js`, inside the existing `describe('workflow stages admin API', ...)` block. First, extend the existing `beforeAll` to also create a group (add right after the existing `roleId` setup):

```javascript
    const [group] = await db('groups').insert({ tenant_id: TENANT_ID, name: 'Reviewers Group' }).returning('id');
    groupId = group.id;
```

Declare `let groupId;` alongside the existing `let workflowTemplateId; let roleId;` at the top of the `describe` block.

Extend the existing `afterAll` to also clean up: add `await db('groups').where({ tenant_id: TENANT_ID }).del();` — place it after the `workflow_templates` cleanup line and before the `roles` cleanup line (groups has no FK dependency on workflow_stages that would block deletion at this point, since this test's stages will already be gone by then, but keep it in dependency order for clarity: workflow_stages already deleted first in the existing cleanup, so groups can be deleted any time after that).

Add a new test after the existing `'adds a user-assigned stage, then a role-assigned stage, in order'` test:

```javascript
  it('adds a group-assigned stage', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 4, name: 'Group Review', assigneeType: 'group', assigneeGroupId: groupId });
    expect(response.status).toBe(201);
    expect(response.body.assignee_type).toBe('group');
    expect(response.body.assignee_group_id).toBe(groupId);
  });

  it('rejects an assigneeGroupId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 5,
        name: 'Bad Group',
        assigneeType: 'group',
        assigneeGroupId: '00000000-1111-2222-3333-444444444444',
      });
    expect(response.status).toBe(400);
  });
```

(These reuse `stageOrder: 4` and `5` since the existing tests in this file already use `1`, `2`, and `3`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- workflowStages.test.js`
Expected: FAIL — `assigneeType must be one of: user, role` (400 instead of the expected 201), since `'group'` isn't accepted yet.

- [ ] **Step 3: Implement**

In `backend/src/services/workflowTemplateService.js`, change:

```javascript
const ALLOWED_ASSIGNEE_TYPES = ['user', 'role'];
```
to:
```javascript
const ALLOWED_ASSIGNEE_TYPES = ['user', 'role', 'group'];
```

Then change the input destructuring:
```javascript
  const { stageOrder, name, assigneeType, assigneeUserId, assigneeRoleId, allowedActions } = input;
```
to:
```javascript
  const { stageOrder, name, assigneeType, assigneeUserId, assigneeRoleId, assigneeGroupId, allowedActions } = input;
```

Then change the validation `if (assigneeType === 'user') { ... } else { ...role... }` block:
```javascript
  if (assigneeType === 'user') {
    assertUuid(assigneeUserId, 'assigneeUserId');
    const user = await db('users').where({ tenant_id: tenantId, id: assigneeUserId }).first();
    if (!user) {
      throw new AppError(400, 'assigneeUserId does not belong to this tenant');
    }
  } else {
    assertUuid(assigneeRoleId, 'assigneeRoleId');
    const role = await db('roles').where({ tenant_id: tenantId, id: assigneeRoleId }).first();
    if (!role) {
      throw new AppError(400, 'assigneeRoleId does not belong to this tenant');
    }
  }
```
to a three-way branch:
```javascript
  if (assigneeType === 'user') {
    assertUuid(assigneeUserId, 'assigneeUserId');
    const user = await db('users').where({ tenant_id: tenantId, id: assigneeUserId }).first();
    if (!user) {
      throw new AppError(400, 'assigneeUserId does not belong to this tenant');
    }
  } else if (assigneeType === 'role') {
    assertUuid(assigneeRoleId, 'assigneeRoleId');
    const role = await db('roles').where({ tenant_id: tenantId, id: assigneeRoleId }).first();
    if (!role) {
      throw new AppError(400, 'assigneeRoleId does not belong to this tenant');
    }
  } else {
    assertUuid(assigneeGroupId, 'assigneeGroupId');
    const group = await db('groups').where({ tenant_id: tenantId, id: assigneeGroupId }).first();
    if (!group) {
      throw new AppError(400, 'assigneeGroupId does not belong to this tenant');
    }
  }
```

Then update the insert:
```javascript
  const [stage] = await db('workflow_stages')
    .insert({
      tenant_id: tenantId,
      workflow_template_id: workflowTemplateId,
      stage_order: stageOrder,
      name,
      assignee_type: assigneeType,
      assignee_user_id: assigneeType === 'user' ? assigneeUserId : null,
      assignee_role_id: assigneeType === 'role' ? assigneeRoleId : null,
      allowed_actions: JSON.stringify(actions),
    })
    .returning('*');
```
to:
```javascript
  const [stage] = await db('workflow_stages')
    .insert({
      tenant_id: tenantId,
      workflow_template_id: workflowTemplateId,
      stage_order: stageOrder,
      name,
      assignee_type: assigneeType,
      assignee_user_id: assigneeType === 'user' ? assigneeUserId : null,
      assignee_role_id: assigneeType === 'role' ? assigneeRoleId : null,
      assignee_group_id: assigneeType === 'group' ? assigneeGroupId : null,
      allowed_actions: JSON.stringify(actions),
    })
    .returning('*');
```

No change needed to `getWorkflowTemplate` — its stages query has no explicit `.select(...)`, so `assignee_group_id` is already included in every returned stage.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- workflowStages.test.js`
Expected: PASS (6 tests: the existing 4 plus the 2 new ones)

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/workflowTemplateService.js backend/tests/workflowStages.test.js
git commit -m "feat: accept group as a workflow stage assignee"
```

---

## Task 3: Claim flow — group membership check

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js`
- Test: `backend/tests/instances.claim.test.js`

**Interfaces:**
- Consumes: `user_groups` table (existing).
- Produces: `claimInstance` accepts a claim from any member of a group-assigned stage's `assignee_group_id`, rejecting (403) a non-member, matching the existing role behavior exactly.

- [ ] **Step 1: Write the failing test**

Add a second `describe` block to `backend/tests/instances.claim.test.js` (after the existing `describe('claiming a role-assigned stage', ...)` block, as a sibling, not nested), mirroring its structure exactly but for a group:

```javascript
describe('claiming a group-assigned stage', () => {
  const G_TENANT_ID = 'c2000000-0000-0000-0000-000000000001';
  const G_ADMIN_ID = 'c2000000-0000-0000-0000-000000000002';
  const G_MEMBER_ID = 'c2000000-0000-0000-0000-000000000003';
  const G_OUTSIDER_ID = 'c2000000-0000-0000-0000-000000000004';
  const gAdminToken = signToken({ sub: G_ADMIN_ID, tenant_id: G_TENANT_ID, is_admin: true });
  const gMemberToken = signToken({ sub: G_MEMBER_ID, tenant_id: G_TENANT_ID, is_admin: false });
  const gOutsiderToken = signToken({ sub: G_OUTSIDER_ID, tenant_id: G_TENANT_ID, is_admin: false });

  let gInstanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: G_TENANT_ID, name: 'Group Claim Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: G_ADMIN_ID, tenant_id: G_TENANT_ID, email: 'gclaim-admin@example.com', password_hash: 'x', is_admin: true },
        { id: G_MEMBER_ID, tenant_id: G_TENANT_ID, email: 'gclaim-member@example.com', password_hash: 'x' },
        { id: G_OUTSIDER_ID, tenant_id: G_TENANT_ID, email: 'gclaim-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [group] = await db('groups').insert({ tenant_id: G_TENANT_ID, name: 'Claim Group' }).returning('id');
    await db('user_groups').insert({ tenant_id: G_TENANT_ID, user_id: G_MEMBER_ID, group_id: group.id });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ name: 'Group Claim Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${gAdminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ name: 'Group Claim Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ stageOrder: 1, name: 'Review', assigneeType: 'group', assigneeGroupId: group.id });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({
        name: 'Group Claim Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${gMemberToken}`)
      .send({ documentTypeId: documentType.body.id });
    gInstanceId = started.body.id;
  });

  afterAll(async () => {
    await db('stage_actions').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: G_TENANT_ID }).del();
    await db('document_types').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: G_TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: G_TENANT_ID }).del();
    await db('template_files').where({ tenant_id: G_TENANT_ID }).del();
    await db('user_groups').where({ tenant_id: G_TENANT_ID }).del();
    await db('groups').where({ tenant_id: G_TENANT_ID }).del();
    await db('users').where({ tenant_id: G_TENANT_ID }).del();
    await db('tenants').where({ id: G_TENANT_ID }).del();
  });

  it('rejects a claim from a user who is not a member of the assigned group', async () => {
    const response = await request(app)
      .post(`/instances/${gInstanceId}/claim`)
      .set('Authorization', `Bearer ${gOutsiderToken}`);
    expect(response.status).toBe(403);
  });

  it('lets a group member claim the instance, then rejects a second claim', async () => {
    const claimResponse = await request(app)
      .post(`/instances/${gInstanceId}/claim`)
      .set('Authorization', `Bearer ${gMemberToken}`);
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.body.claimed_by).toBe(G_MEMBER_ID);

    const secondClaim = await request(app)
      .post(`/instances/${gInstanceId}/claim`)
      .set('Authorization', `Bearer ${gMemberToken}`);
    expect(secondClaim.status).toBe(400);
  });
});
```

Note this new `describe` block does NOT call `db.destroy()` in its own `afterAll` (the existing first `describe` block already does, and Jest runs both `describe` blocks in the same file against the same connection pool — calling `db.destroy()` twice, or in the wrong order relative to the other block's queries, would break the other block). Instead, move the existing `await db.destroy();` out of the first `describe`'s `afterAll` and into a single top-level `afterAll` that runs after both blocks — check `backend/tests/instances.claim.test.js`'s exact current structure first and adjust so `db.destroy()` is called exactly once, after all tests in the file, using whatever Jest pattern (a top-level `afterAll` outside both `describe` blocks) fits the file's existing style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- instances.claim.test.js`
Expected: FAIL — starting the instance fails at the workflow-stage-creation step (the admin API rejects `assigneeType: 'group'` until Task 2 is deployed — Task 2 must be complete before this task; if Task 2 isn't done yet, that's a plan-ordering bug, not a Task 3 problem) OR, if Task 2 is already in place, the claim endpoint returns 500/403-when-should-be-200 because `claimInstance` doesn't yet check group membership.

- [ ] **Step 3: Implement**

In `backend/src/services/workflowInstanceService.js`, find `claimInstance`:

```javascript
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

Change it to:

```javascript
async function claimInstance(tenantId, userId, instanceId) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be claimed');
  }
  if (stage.assignee_type !== 'role' && stage.assignee_type !== 'group') {
    throw new AppError(400, 'The current stage is not role- or group-assigned; claiming does not apply');
  }
  if (instance.claimed_by) {
    throw new AppError(400, 'This instance has already been claimed');
  }

  if (stage.assignee_type === 'role') {
    const hasRole = await db('user_roles')
      .where({ tenant_id: tenantId, user_id: userId, role_id: stage.assignee_role_id })
      .first();
    if (!hasRole) {
      throw new AppError(403, 'You do not hold the role assigned to this stage');
    }
  } else {
    const isMember = await db('user_groups')
      .where({ tenant_id: tenantId, user_id: userId, group_id: stage.assignee_group_id })
      .first();
    if (!isMember) {
      throw new AppError(403, 'You are not a member of the group assigned to this stage');
    }
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- instances.claim.test.js`
Expected: PASS (4 tests: the existing 2 plus the 2 new ones)

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/workflowInstanceService.js backend/tests/instances.claim.test.js
git commit -m "feat: allow group members to claim a group-assigned stage"
```

---

## Task 4: "My tasks" eligibility for unclaimed group-assigned instances

**Files:**
- Modify: `backend/src/services/dashboardService.js`
- Test: `backend/tests/instances.myTasks.test.js`

**Interfaces:**
- Produces: `listMyTasks` surfaces an unclaimed group-assigned instance under `assignedToMe` for every member of the assigned group, mirroring the existing `eligibleToClaimRole` behavior.

- [ ] **Step 1: Write the failing test**

Add a second `describe` block to `backend/tests/instances.myTasks.test.js` (as a sibling to the existing `describe('GET /instances/my-tasks', ...)` block), following the same structure and cleanup-ordering note as Task 3 (only one `db.destroy()` call in the file, after both blocks):

```javascript
describe('GET /instances/my-tasks — group-assigned stage', () => {
  const G_TENANT_ID = 'e1000000-0000-0000-0000-000000000001';
  const G_ADMIN_ID = 'e1000000-0000-0000-0000-000000000002';
  const G_SUBMITTER_ID = 'e1000000-0000-0000-0000-000000000003';
  const G_MEMBER_ID = 'e1000000-0000-0000-0000-000000000004';
  const gAdminToken = signToken({ sub: G_ADMIN_ID, tenant_id: G_TENANT_ID, is_admin: true });
  const gSubmitterToken = signToken({ sub: G_SUBMITTER_ID, tenant_id: G_TENANT_ID, is_admin: false });
  const gMemberToken = signToken({ sub: G_MEMBER_ID, tenant_id: G_TENANT_ID, is_admin: false });

  let gInstanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: G_TENANT_ID, name: 'My Tasks Group Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: G_ADMIN_ID, tenant_id: G_TENANT_ID, email: 'gmt-admin@example.com', password_hash: 'x', is_admin: true },
        { id: G_SUBMITTER_ID, tenant_id: G_TENANT_ID, email: 'gmt-submitter@example.com', password_hash: 'x' },
        { id: G_MEMBER_ID, tenant_id: G_TENANT_ID, email: 'gmt-member@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [group] = await db('groups').insert({ tenant_id: G_TENANT_ID, name: 'My Tasks Group' }).returning('id');
    await db('user_groups').insert({ tenant_id: G_TENANT_ID, user_id: G_MEMBER_ID, group_id: group.id });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ name: 'My Tasks Group Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${gAdminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ name: 'My Tasks Group Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({ stageOrder: 1, name: 'Review', assigneeType: 'group', assigneeGroupId: group.id });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${gAdminToken}`)
      .send({
        name: 'My Tasks Group Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${gSubmitterToken}`)
      .send({ documentTypeId: documentType.body.id });
    gInstanceId = started.body.id;
  });

  afterAll(async () => {
    await db('notifications').where({ tenant_id: G_TENANT_ID }).del();
    await db('stage_actions').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: G_TENANT_ID }).del();
    await db('document_types').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: G_TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: G_TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: G_TENANT_ID }).del();
    await db('template_files').where({ tenant_id: G_TENANT_ID }).del();
    await db('user_groups').where({ tenant_id: G_TENANT_ID }).del();
    await db('groups').where({ tenant_id: G_TENANT_ID }).del();
    await db('users').where({ tenant_id: G_TENANT_ID }).del();
    await db('tenants').where({ id: G_TENANT_ID }).del();
  });

  it('puts an unclaimed group-assigned instance in assignedToMe for a group member', async () => {
    const response = await request(app).get('/instances/my-tasks').set('Authorization', `Bearer ${gMemberToken}`);
    expect(response.status).toBe(200);
    expect(response.body.assignedToMe.map((i) => i.id)).toContain(gInstanceId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- instances.myTasks.test.js`
Expected: FAIL — the group member's `assignedToMe` list does not contain the instance, because `dashboardService.listMyTasks` has no group-eligibility check yet.

- [ ] **Step 3: Implement**

In `backend/src/services/dashboardService.js`, find `listMyTasks`:

```javascript
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
```

Change it to:

```javascript
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
  const userGroupIds = (
    await db('user_groups').where({ tenant_id: tenantId, user_id: userId }).select('group_id')
  ).map((row) => row.group_id);

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
    const eligibleToClaimGroup =
      stage.assignee_type === 'group' && !instance.claimed_by && userGroupIds.includes(stage.assignee_group_id);
    const isMine = canAct(stage, instance, userId) || eligibleToClaimRole || eligibleToClaimGroup;

    if (isMine) {
      assignedToMe.push({ ...instance, currentStage: stage });
    } else if (instance.created_by === userId) {
      waitingOnOthers.push({ ...instance, currentStage: stage });
    }
  }
```

(The rest of the function — `completed` query and the `return` — is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- instances.myTasks.test.js`
Expected: PASS (4 tests: the existing 3 plus the 1 new one)

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/dashboardService.js backend/tests/instances.myTasks.test.js
git commit -m "feat: surface unclaimed group-assigned instances in my-tasks"
```

---

## Task 5: Notifications — email every group member

**Files:**
- Modify: `backend/src/services/notificationService.js`
- Test: `backend/tests/notificationService.test.js`

**Interfaces:**
- Produces: `resolveStageRecipientEmails` returns every member's email for a group-assigned stage, mirroring the existing role-holder branch.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/notificationService.test.js`. First extend `beforeAll` to also create a group with two members (add after the existing role/user_roles setup):

```javascript
    const [group] = await db('groups').insert({ tenant_id: TENANT_ID, name: 'Notify Group' }).returning('id');
    groupId = group.id;
    await db('user_groups').insert([
      { tenant_id: TENANT_ID, user_id: USER_A, group_id: groupId },
      { tenant_id: TENANT_ID, user_id: USER_B, group_id: groupId },
    ]);
```

Declare `let groupId;` alongside the existing `let roleId;`.

Extend `afterAll` to also clean up groups (add before the existing `roles` cleanup line, after a new `user_groups` cleanup line):
```javascript
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
```

Add a new test after the existing `'enqueues one notification per role-holder for a role-assigned stage'` test:

```javascript
  it('enqueues one notification per member for a group-assigned stage', async () => {
    const stage = { assignee_type: 'group', assignee_group_id: groupId };
    await notifyStage(TENANT_ID, INSTANCE_ID, 'assigned', stage, {
      documentTypeName: 'IT Request',
      stageName: 'Triage',
    });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID }).orderBy('recipient_email');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recipient_email)).toEqual(['notif-a@example.com', 'notif-b@example.com']);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- notificationService.test.js`
Expected: FAIL — 0 notifications enqueued (or a crash), since `resolveStageRecipientEmails` has no group branch yet and falls into the role-holder query with `stage.assignee_role_id` undefined.

- [ ] **Step 3: Implement**

In `backend/src/services/notificationService.js`, find `resolveStageRecipientEmails`:

```javascript
async function resolveStageRecipientEmails(tenantId, stage) {
  if (stage.assignee_type === 'user') {
    const user = await db('users').where({ tenant_id: tenantId, id: stage.assignee_user_id }).first();
    return user ? [user.email] : [];
  }

  const roleHolders = await db('user_roles')
    .join('users', 'users.id', 'user_roles.user_id')
    .where({ 'user_roles.tenant_id': tenantId, 'user_roles.role_id': stage.assignee_role_id })
    .select('users.email');
  return roleHolders.map((row) => row.email);
}
```

Change it to:

```javascript
async function resolveStageRecipientEmails(tenantId, stage) {
  if (stage.assignee_type === 'user') {
    const user = await db('users').where({ tenant_id: tenantId, id: stage.assignee_user_id }).first();
    return user ? [user.email] : [];
  }

  if (stage.assignee_type === 'group') {
    const members = await db('user_groups')
      .join('users', 'users.id', 'user_groups.user_id')
      .where({ 'user_groups.tenant_id': tenantId, 'user_groups.group_id': stage.assignee_group_id })
      .select('users.email');
    return members.map((row) => row.email);
  }

  const roleHolders = await db('user_roles')
    .join('users', 'users.id', 'user_roles.user_id')
    .where({ 'user_roles.tenant_id': tenantId, 'user_roles.role_id': stage.assignee_role_id })
    .select('users.email');
  return roleHolders.map((row) => row.email);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- notificationService.test.js`
Expected: PASS (5 tests: the existing 4 plus the 1 new one)

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/notificationService.js backend/tests/notificationService.test.js
git commit -m "feat: notify every group member for a group-assigned stage"
```

---

## Task 6: Group deletion guard

**Files:**
- Modify: `backend/src/services/groupService.js`
- Test: `backend/tests/groupService.test.js`

**Interfaces:**
- Produces: `deleteGroup(tenantId, groupId)` throws `AppError(409, ...)` if any `workflow_stages` row in this tenant has `assignee_group_id` equal to `groupId`; otherwise deletes as before.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/groupService.test.js`, a new test after the existing `'rejects renaming a group to a name already used by another group in this tenant'` test. This test needs a `workflow_templates`/`workflow_stages` fixture, created via direct DB inserts (this file doesn't use `supertest`/HTTP elsewhere, so stay consistent with that):

```javascript
  it('rejects deleting a group that is still assigned to a workflow stage', async () => {
    const group = await createGroup(TENANT_ID, 'In-Use Group');

    const [workflowTemplate] = await db('workflow_templates')
      .insert({ tenant_id: TENANT_ID, name: 'In-Use Workflow' })
      .returning('id');
    await db('workflow_stages').insert({
      tenant_id: TENANT_ID,
      workflow_template_id: workflowTemplate.id,
      stage_order: 1,
      name: 'Review',
      assignee_type: 'group',
      assignee_group_id: group.id,
      allowed_actions: JSON.stringify(['forward', 'send_back', 'reject']),
    });

    await expect(deleteGroup(TENANT_ID, group.id)).rejects.toThrow(AppError);

    await db('workflow_stages').where({ tenant_id: TENANT_ID, workflow_template_id: workflowTemplate.id }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID, id: workflowTemplate.id }).del();
    await deleteGroup(TENANT_ID, group.id);
  });
```

This test cleans up its own `workflow_templates`/`workflow_stages` rows inline (deleting the stage, then the template, then successfully deleting the group at the end) rather than relying on the file's `afterAll`, since those two tables aren't otherwise touched by this test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- groupService.test.js`
Expected: FAIL — `deleteGroup` succeeds immediately (no rejection) instead of throwing, since there's no guard yet.

- [ ] **Step 3: Implement**

In `backend/src/services/groupService.js`, find `deleteGroup`:

```javascript
async function deleteGroup(tenantId, groupId) {
  await requireGroup(tenantId, groupId);
  await db('groups').where({ tenant_id: tenantId, id: groupId }).del();
}
```

Change it to:

```javascript
async function deleteGroup(tenantId, groupId) {
  await requireGroup(tenantId, groupId);
  const stageUsingGroup = await db('workflow_stages')
    .where({ tenant_id: tenantId, assignee_group_id: groupId })
    .first();
  if (stageUsingGroup) {
    throw new AppError(409, 'Group is assigned to one or more workflow stages and cannot be deleted');
  }
  await db('groups').where({ tenant_id: tenantId, id: groupId }).del();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- groupService.test.js`
Expected: PASS (7 tests: the existing 6 plus the 1 new one)

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/groupService.js backend/tests/groupService.test.js
git commit -m "feat: block deleting a group still assigned to a workflow stage"
```

---

## Task 7: Frontend — "Assign to group" option in the stage builder

**Files:**
- Modify: `frontend/src/api/workflowTemplates.ts`
- Modify: `frontend/src/pages/admin/WorkflowTemplateDetailPage.tsx`

**Interfaces:**
- Consumes: `listGroups` from `frontend/src/api/groups.ts` (existing, from sub-project 1) — `AdminGroup { id: string; name: string; memberCount: number }`.
- Produces: `WorkflowStage.assignee_group_id: string | null` added to the existing interface; `AddStageInput.assigneeGroupId?: string` added; the stage-builder form gains a third radio option.

- [ ] **Step 1: Update the TypeScript types**

In `frontend/src/api/workflowTemplates.ts`, change:

```typescript
export interface WorkflowStage {
  id: string;
  workflow_template_id: string;
  stage_order: number;
  name: string;
  assignee_type: 'user' | 'role';
  assignee_user_id: string | null;
  assignee_role_id: string | null;
  allowed_actions: string[];
  created_at: string;
}
```
to:
```typescript
export interface WorkflowStage {
  id: string;
  workflow_template_id: string;
  stage_order: number;
  name: string;
  assignee_type: 'user' | 'role' | 'group';
  assignee_user_id: string | null;
  assignee_role_id: string | null;
  assignee_group_id: string | null;
  allowed_actions: string[];
  created_at: string;
}
```

And change:
```typescript
export interface AddStageInput {
  stageOrder: number;
  name: string;
  assigneeType: 'user' | 'role';
  assigneeUserId?: string;
  assigneeRoleId?: string;
  allowedActions: string[];
}
```
to:
```typescript
export interface AddStageInput {
  stageOrder: number;
  name: string;
  assigneeType: 'user' | 'role' | 'group';
  assigneeUserId?: string;
  assigneeRoleId?: string;
  assigneeGroupId?: string;
  allowedActions: string[];
}
```

- [ ] **Step 2: Update `WorkflowTemplateDetailPage.tsx`**

Add an import:
```tsx
import { listGroups } from '../../api/groups';
```

Add a query, alongside the existing `users`/`roles` queries:
```tsx
  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: listGroups });
```

Change the assignee-type state type and add group state, alongside the existing:
```tsx
  const [assigneeType, setAssigneeType] = useState<'user' | 'role'>('user');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assigneeRoleId, setAssigneeRoleId] = useState('');
```
to:
```tsx
  const [assigneeType, setAssigneeType] = useState<'user' | 'role' | 'group'>('user');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assigneeRoleId, setAssigneeRoleId] = useState('');
  const [assigneeGroupId, setAssigneeGroupId] = useState('');
```

Update the mutation's payload, changing:
```tsx
      addWorkflowStage(id!, {
        stageOrder,
        name: stageName,
        assigneeType,
        assigneeUserId: assigneeType === 'user' ? assigneeUserId : undefined,
        assigneeRoleId: assigneeType === 'role' ? assigneeRoleId : undefined,
        allowedActions,
      }),
```
to:
```tsx
      addWorkflowStage(id!, {
        stageOrder,
        name: stageName,
        assigneeType,
        assigneeUserId: assigneeType === 'user' ? assigneeUserId : undefined,
        assigneeRoleId: assigneeType === 'role' ? assigneeRoleId : undefined,
        assigneeGroupId: assigneeType === 'group' ? assigneeGroupId : undefined,
        allowedActions,
      }),
```

Update the stage list display, changing:
```tsx
            — {stage.assignee_type === 'user' ? 'assigned user' : 'assigned role'} — actions:{' '}
```
to:
```tsx
            —{' '}
            {stage.assignee_type === 'user'
              ? 'assigned user'
              : stage.assignee_type === 'role'
                ? 'assigned role'
                : 'assigned group'}{' '}
            — actions:{' '}
```

Update the radio group, changing:
```tsx
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={assigneeType === 'user'}
              onChange={() => setAssigneeType('user')}
            />
            Assign to user
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={assigneeType === 'role'}
              onChange={() => setAssigneeType('role')}
            />
            Assign to role
          </label>
        </div>
```
to:
```tsx
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={assigneeType === 'user'}
              onChange={() => setAssigneeType('user')}
            />
            Assign to user
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={assigneeType === 'role'}
              onChange={() => setAssigneeType('role')}
            />
            Assign to role
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={assigneeType === 'group'}
              onChange={() => setAssigneeType('group')}
            />
            Assign to group
          </label>
        </div>
```

Update the conditional picker, changing:
```tsx
        {assigneeType === 'user' ? (
          <label className="block text-sm">
            User
            <select
              required
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a user</option>
              {users?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name ? `${user.full_name} (${user.email})` : user.email}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-sm">
            Role
            <select
              required
              value={assigneeRoleId}
              onChange={(e) => setAssigneeRoleId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a role</option>
              {roles?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
        )}
```
to:
```tsx
        {assigneeType === 'user' ? (
          <label className="block text-sm">
            User
            <select
              required
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a user</option>
              {users?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name ? `${user.full_name} (${user.email})` : user.email}
                </option>
              ))}
            </select>
          </label>
        ) : assigneeType === 'role' ? (
          <label className="block text-sm">
            Role
            <select
              required
              value={assigneeRoleId}
              onChange={(e) => setAssigneeRoleId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a role</option>
              {roles?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-sm">
            Group
            <select
              required
              value={assigneeGroupId}
              onChange={(e) => setAssigneeGroupId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a group</option>
              {groups?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
        )}
```

- [ ] **Step 3: Verify with a build**

Run (from `frontend/`): `npm run build` (tsc -b && vite build)
Expected: zero TypeScript errors.

- [ ] **Step 4: Manually verify in the browser**

Run (from `frontend/`): `npm run dev`. Log in as an admin, open a workflow template, add a stage with "Assign to group" selected and a group chosen, confirm it appears in the stage list as "assigned group".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/workflowTemplates.ts frontend/src/pages/admin/WorkflowTemplateDetailPage.tsx
git commit -m "feat: add group option to the workflow stage builder"
```

---

## Self-review notes (for the plan author, already applied above)

- **Spec coverage:** §2 schema → Task 1. §3 claim semantics → Task 3. §4 my-tasks → Task 4. §5 deletion guard → Task 6. §6 notifications → Task 5. §7 admin API → Task 2. §8 frontend → Task 7. §9 out-of-scope items correctly untouched.
- **Task ordering:** Task 2 (admin API accepts `assigneeType: 'group'`) must land before Tasks 3-6, since their tests all create a group-assigned stage via the admin API to set up their fixtures. The tasks are listed in dependency order.
- **Type consistency:** `assigneeGroupId`/`assignee_group_id` naming is consistent across the migration (Task 1), service layer (Tasks 2, 3, 4, 5, 6), and frontend types (Task 7) — camelCase at the API/service-input boundary, snake_case in the DB/response, matching the existing `assigneeRoleId`/`assignee_role_id` convention exactly.
- **No placeholders:** every step includes runnable code. The note about `db.destroy()` being called only once per test file (Tasks 3, 4) is a real correctness requirement for Jest test files sharing a connection pool across sibling `describe` blocks, not a deferred decision — the executor must check the file's exact current structure before adding a second `describe` block, since sub-project 1's tests were all single-`describe`-block files and this is the first plan to add a second one to an existing file.
