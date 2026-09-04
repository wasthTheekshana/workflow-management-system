# Groups & Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-scoped Groups feature (many-to-many user membership, admin-managed), a server-enforced visibility rule that restricts which users/groups a non-admin user can see to their own group-mates, and a human-readable sequential ticket number on every workflow instance.

**Architecture:** Backend follows the existing `roles`/`user_roles` pattern exactly for `groups`/`user_groups` (same migration shape, same service/route layering: `src/services/*.js` for business rules, `src/routes/**/*.js` for HTTP only). Ticket numbers are generated entirely inside a Postgres trigger (`BEFORE INSERT` on `workflow_instances`, backed by a `tenant_ticket_counters` table with an atomic upsert) rather than in application code, so every existing and future insert path — including the many test fixtures that insert into `workflow_instances` directly — gets a ticket number for free with zero changes to `workflowInstanceService.js` or any route. Frontend adds one new admin section (`/admin/groups`, `/admin/groups/:id`) mirroring the existing `WorkflowTemplatesPage`/`WorkflowTemplateDetailPage` list+detail pattern, plus a small ticket-number display on `MyTasksPage` and `InstanceDetailPage`.

**Tech Stack:** Node.js/Express, Knex (PostgreSQL), Jest + Supertest (backend tests). React + Vite + TypeScript + Tailwind, TanStack Query, React Router (frontend, no automated tests — manual browser verification, matching the rest of this project).

**Spec:** `docs/superpowers/specs/2026-09-04-groups-and-visibility-design.md`

## Global Constraints

- Every table (other than `tenants`) carries `tenant_id`; every query is scoped by the `tenant_id` from the verified JWT (`req.user.tenantId`) — never a client-supplied value.
- All DB access via Knex query builder; no string-built SQL. UUID-shaped path/body params validated with `assertUuid` before use.
- Admin-only routes use `router.use(authenticate, requireAdmin)` exactly like `src/routes/admin/roles.js`.
- Error shape is always `{ error: string }`, thrown as `new AppError(statusCode, message)` and passed to `next(err)`.
- No automated frontend tests in this project — verify each frontend task by running the dev server and checking in a real browser.
- Backend tests run via `npm test` in `backend/`; `pretest` runs `knex migrate:latest` against the test DB automatically, so no manual migration step is needed before running tests.

---

## Task 1: Groups & membership migration

**Files:**
- Create: `backend/migrations/012_create_groups.js`

**Interfaces:**
- Produces: tables `groups` (`id`, `tenant_id`, `name`, timestamps, unique `(tenant_id, name)`, unique `(tenant_id, id)`) and `user_groups` (`id`, `tenant_id`, `user_id`, `group_id`, `created_at`, unique `(user_id, group_id)`, composite FKs to `users` and `groups` scoped by tenant) — the exact shape of `roles`/`user_roles`.

- [ ] **Step 1: Write the migration**

```javascript
exports.up = function up(knex) {
  return knex.schema
    .createTable('groups', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('name').notNullable();
      table.timestamps(true, true);

      table.unique(['tenant_id', 'name']);
      table.index('tenant_id');
      table.unique(['tenant_id', 'id']);
    })
    .createTable('user_groups', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('user_id').notNullable();
      table.uuid('group_id').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.unique(['user_id', 'group_id']);
      table.index('tenant_id');
      table.index('user_id');
      table.index('group_id');

      table.foreign(['tenant_id', 'user_id']).references(['tenant_id', 'id']).inTable('users').onDelete('CASCADE');
      table.foreign(['tenant_id', 'group_id']).references(['tenant_id', 'id']).inTable('groups').onDelete('CASCADE');
    });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('user_groups').dropTableIfExists('groups');
};
```

- [ ] **Step 2: Run the migration against the dev DB**

Run (from `backend/`): `npm run migrate`
Expected: `Batch N run: 1 migrations` including `012_create_groups.js`, no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/012_create_groups.js
git commit -m "feat: add groups and user_groups tables"
```

---

## Task 2: `groupService.js` — CRUD and membership

**Files:**
- Create: `backend/src/services/groupService.js`
- Test: `backend/tests/groupService.test.js`

**Interfaces:**
- Consumes: `db` from `../config/db`, `AppError` from `../utils/AppError`, `assertUuid`/`assertRequiredString` from `../utils/validation`.
- Produces (used by Task 3's routes):
  - `listGroups(tenantId): Promise<{id, name, memberCount}[]>`
  - `createGroup(tenantId, name): Promise<{id, name}>`
  - `getGroupWithMembers(tenantId, groupId): Promise<{id, name, members: {id, email, full_name}[]}>` — throws `AppError(404, ...)` if not found
  - `renameGroup(tenantId, groupId, name): Promise<{id, name}>`
  - `deleteGroup(tenantId, groupId): Promise<void>`
  - `addMember(tenantId, groupId, userId): Promise<void>` — throws `AppError(400, ...)` if `userId` doesn't belong to the tenant, `AppError(404, ...)` if the group doesn't
  - `removeMember(tenantId, groupId, userId): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/tests/groupService.test.js
const db = require('../src/config/db');
const AppError = require('../src/utils/AppError');
const {
  listGroups,
  createGroup,
  getGroupWithMembers,
  renameGroup,
  deleteGroup,
  addMember,
  removeMember,
} = require('../src/services/groupService');

const TENANT_ID = 'ac000000-0000-0000-0000-000000000001';
const OTHER_TENANT_ID = 'ac000000-0000-0000-0000-000000000099';
const USER_ID = 'ac000000-0000-0000-0000-000000000002';

describe('groupService', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Group Service Test Tenant' }).onConflict('id').ignore();
    await db('tenants').insert({ id: OTHER_TENANT_ID, name: 'Other Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: USER_ID, tenant_id: TENANT_ID, email: 'gs-user@example.com', password_hash: 'x' })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').whereIn('tenant_id', [TENANT_ID, OTHER_TENANT_ID]).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').whereIn('id', [TENANT_ID, OTHER_TENANT_ID]).del();
    await db.destroy();
  });

  it('creates, lists, renames, and deletes a group', async () => {
    const created = await createGroup(TENANT_ID, 'IT Group');
    expect(created.name).toBe('IT Group');

    const listed = await listGroups(TENANT_ID);
    expect(listed.find((g) => g.id === created.id)).toBeTruthy();

    const renamed = await renameGroup(TENANT_ID, created.id, 'IT Team');
    expect(renamed.name).toBe('IT Team');

    await deleteGroup(TENANT_ID, created.id);
    const afterDelete = await listGroups(TENANT_ID);
    expect(afterDelete.find((g) => g.id === created.id)).toBeUndefined();
  });

  it('adds and removes members, reflected in getGroupWithMembers', async () => {
    const group = await createGroup(TENANT_ID, 'Finance Group');

    await addMember(TENANT_ID, group.id, USER_ID);
    const withMember = await getGroupWithMembers(TENANT_ID, group.id);
    expect(withMember.members.map((m) => m.id)).toContain(USER_ID);

    await removeMember(TENANT_ID, group.id, USER_ID);
    const withoutMember = await getGroupWithMembers(TENANT_ID, group.id);
    expect(withoutMember.members.map((m) => m.id)).not.toContain(USER_ID);
  });

  it('rejects adding a user from a different tenant', async () => {
    const group = await createGroup(TENANT_ID, 'Cross-Tenant Test Group');
    await expect(addMember(TENANT_ID, group.id, 'ac000000-0000-0000-0000-000000000999')).rejects.toThrow(AppError);
  });

  it('throws 404 for a group in another tenant', async () => {
    const group = await createGroup(OTHER_TENANT_ID, 'Other Tenant Group');
    await expect(getGroupWithMembers(TENANT_ID, group.id)).rejects.toThrow(AppError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- groupService.test.js`
Expected: FAIL — `Cannot find module '../src/services/groupService'`

- [ ] **Step 3: Write `groupService.js`**

```javascript
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');

async function listGroups(tenantId) {
  const groups = await db('groups').where({ tenant_id: tenantId }).select('id', 'name').orderBy('name');
  const counts = await db('user_groups')
    .where({ tenant_id: tenantId })
    .groupBy('group_id')
    .select('group_id')
    .count('* as count');
  const countByGroupId = new Map(counts.map((row) => [row.group_id, Number(row.count)]));
  return groups.map((group) => ({ ...group, memberCount: countByGroupId.get(group.id) || 0 }));
}

async function createGroup(tenantId, name) {
  assertRequiredString(name, 'name');
  const [group] = await db('groups').insert({ tenant_id: tenantId, name }).returning(['id', 'name']);
  return group;
}

async function requireGroup(tenantId, groupId) {
  assertUuid(groupId, 'groupId');
  const group = await db('groups').where({ tenant_id: tenantId, id: groupId }).first();
  if (!group) {
    throw new AppError(404, 'Group not found');
  }
  return group;
}

async function getGroupWithMembers(tenantId, groupId) {
  const group = await requireGroup(tenantId, groupId);
  const members = await db('user_groups')
    .join('users', 'users.id', 'user_groups.user_id')
    .where({ 'user_groups.tenant_id': tenantId, 'user_groups.group_id': groupId })
    .select('users.id', 'users.email', 'users.full_name')
    .orderBy('users.email');
  return { ...group, members };
}

async function renameGroup(tenantId, groupId, name) {
  await requireGroup(tenantId, groupId);
  assertRequiredString(name, 'name');
  const [updated] = await db('groups')
    .where({ tenant_id: tenantId, id: groupId })
    .update({ name })
    .returning(['id', 'name']);
  return updated;
}

async function deleteGroup(tenantId, groupId) {
  await requireGroup(tenantId, groupId);
  await db('groups').where({ tenant_id: tenantId, id: groupId }).del();
}

async function addMember(tenantId, groupId, userId) {
  await requireGroup(tenantId, groupId);
  assertUuid(userId, 'userId');
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    throw new AppError(400, 'userId does not belong to this tenant');
  }
  await db('user_groups').insert({ tenant_id: tenantId, user_id: userId, group_id: groupId }).onConflict(['user_id', 'group_id']).ignore();
}

async function removeMember(tenantId, groupId, userId) {
  await requireGroup(tenantId, groupId);
  assertUuid(userId, 'userId');
  await db('user_groups').where({ tenant_id: tenantId, group_id: groupId, user_id: userId }).del();
}

module.exports = {
  listGroups,
  createGroup,
  getGroupWithMembers,
  renameGroup,
  deleteGroup,
  addMember,
  removeMember,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- groupService.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/groupService.js backend/tests/groupService.test.js
git commit -m "feat: add groupService with CRUD and membership management"
```

---

## Task 3: Admin `/admin/groups` routes

**Files:**
- Create: `backend/src/routes/admin/groups.js`
- Modify: `backend/src/app.js` — mount the new router
- Test: `backend/tests/adminGroups.test.js`

**Interfaces:**
- Consumes: `groupService` functions from Task 2, `authenticate`/`requireAdmin` middleware (existing).
- Produces: `GET /admin/groups`, `POST /admin/groups`, `GET /admin/groups/:id`, `PUT /admin/groups/:id`, `DELETE /admin/groups/:id`, `POST /admin/groups/:id/members`, `DELETE /admin/groups/:id/members/:userId` — all admin-only.

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/tests/adminGroups.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ad000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ad000000-0000-0000-0000-000000000002';
const NON_ADMIN_ID = 'ad000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const nonAdminToken = signToken({ sub: NON_ADMIN_ID, tenant_id: TENANT_ID, is_admin: false });

describe('/admin/groups', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Groups Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ag-admin@example.com', password_hash: 'x', is_admin: true },
        { id: NON_ADMIN_ID, tenant_id: TENANT_ID, email: 'ag-user@example.com', password_hash: 'x', is_admin: false },
      ])
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects a non-admin', async () => {
    const response = await request(app).get('/admin/groups').set('Authorization', `Bearer ${nonAdminToken}`);
    expect(response.status).toBe(403);
  });

  it('creates, lists, updates membership, and deletes a group', async () => {
    const createRes = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'IT Group' });
    expect(createRes.status).toBe(201);
    const groupId = createRes.body.id;

    const listRes = await request(app).get('/admin/groups').set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((g) => g.id === groupId)).toBe(true);

    const addMemberRes = await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: NON_ADMIN_ID });
    expect(addMemberRes.status).toBe(201);

    const detailRes = await request(app).get(`/admin/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.members.map((m) => m.id)).toContain(NON_ADMIN_ID);

    const removeMemberRes = await request(app)
      .delete(`/admin/groups/${groupId}/members/${NON_ADMIN_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removeMemberRes.status).toBe(204);

    const renameRes = await request(app)
      .put(`/admin/groups/${groupId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'IT Team' });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.name).toBe('IT Team');

    const deleteRes = await request(app).delete(`/admin/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- adminGroups.test.js`
Expected: FAIL — 404s, since no route is mounted yet.

- [ ] **Step 3: Write `admin/groups.js` and mount it**

```javascript
// backend/src/routes/admin/groups.js
const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const {
  listGroups,
  createGroup,
  getGroupWithMembers,
  renameGroup,
  deleteGroup,
  addMember,
  removeMember,
} = require('../../services/groupService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    res.status(200).json(await listGroups(req.user.tenantId));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createGroup(req.user.tenantId, req.body.name));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.status(200).json(await getGroupWithMembers(req.user.tenantId, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    res.status(200).json(await renameGroup(req.user.tenantId, req.params.id, req.body.name));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteGroup(req.user.tenantId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members', async (req, res, next) => {
  try {
    await addMember(req.user.tenantId, req.params.id, req.body.user_id);
    res.status(201).end();
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    await removeMember(req.user.tenantId, req.params.id, req.params.userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

In `backend/src/app.js`, add near the other admin router requires:

```javascript
const adminGroupsRouter = require('./routes/admin/groups');
```

and near `app.use('/admin/roles', adminRolesRouter);` add:

```javascript
app.use('/admin/groups', adminGroupsRouter);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- adminGroups.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: all existing tests still PASS (no regressions from the new mounted router).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/admin/groups.js backend/src/app.js backend/tests/adminGroups.test.js
git commit -m "feat: add admin groups CRUD and membership routes"
```

---

## Task 4: Visibility-scoped user/group lookups

**Files:**
- Create: `backend/src/services/visibilityService.js`
- Create: `backend/src/routes/users.js`
- Create: `backend/src/routes/groups.js`
- Modify: `backend/src/app.js` — mount both new routers
- Test: `backend/tests/visibility.test.js`

**Interfaces:**
- Consumes: `db` from `../config/db`.
- Produces:
  - `listVisibleUsers(tenantId, userId, isAdmin): Promise<{id, email, full_name}[]>` — admin: every user in the tenant; non-admin: self plus anyone sharing at least one group.
  - `listVisibleGroups(tenantId, userId, isAdmin): Promise<{id, name}[]>` — admin: every group in the tenant; non-admin: only groups the user belongs to.
  - Routes: `GET /users/visible`, `GET /groups/visible` (any authenticated user).

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/tests/visibility.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ae000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ae000000-0000-0000-0000-000000000002';
const IT_USER_ID = 'ae000000-0000-0000-0000-000000000003';
const IT_USER2_ID = 'ae000000-0000-0000-0000-000000000004';
const OUTSIDER_ID = 'ae000000-0000-0000-0000-000000000005';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const itUserToken = signToken({ sub: IT_USER_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });

describe('visibility-scoped pickers', () => {
  let itGroupId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Visibility Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'vis-admin@example.com', password_hash: 'x', is_admin: true },
        { id: IT_USER_ID, tenant_id: TENANT_ID, email: 'vis-it1@example.com', password_hash: 'x' },
        { id: IT_USER2_ID, tenant_id: TENANT_ID, email: 'vis-it2@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'vis-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [group] = await db('groups').insert({ tenant_id: TENANT_ID, name: 'IT Group' }).returning('id');
    itGroupId = group.id;
    await db('user_groups').insert([
      { tenant_id: TENANT_ID, user_id: IT_USER_ID, group_id: itGroupId },
      { tenant_id: TENANT_ID, user_id: IT_USER2_ID, group_id: itGroupId },
    ]);
  });

  afterAll(async () => {
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('an admin sees every user and group', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${adminToken}`);
    expect(usersRes.body.map((u) => u.id)).toEqual(expect.arrayContaining([IT_USER_ID, IT_USER2_ID, OUTSIDER_ID]));

    const groupsRes = await request(app).get('/groups/visible').set('Authorization', `Bearer ${adminToken}`);
    expect(groupsRes.body.some((g) => g.id === itGroupId)).toBe(true);
  });

  it('a group member sees group-mates and self, but not an outsider', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${itUserToken}`);
    const ids = usersRes.body.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([IT_USER_ID, IT_USER2_ID]));
    expect(ids).not.toContain(OUTSIDER_ID);

    const groupsRes = await request(app).get('/groups/visible').set('Authorization', `Bearer ${itUserToken}`);
    expect(groupsRes.body.some((g) => g.id === itGroupId)).toBe(true);
  });

  it('a user with no shared group sees only themself and no groups', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${outsiderToken}`);
    expect(usersRes.body.map((u) => u.id)).toEqual([OUTSIDER_ID]);

    const groupsRes = await request(app).get('/groups/visible').set('Authorization', `Bearer ${outsiderToken}`);
    expect(groupsRes.body).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- visibility.test.js`
Expected: FAIL — 404s (routes don't exist yet).

- [ ] **Step 3: Write `visibilityService.js`**

```javascript
// backend/src/services/visibilityService.js
const db = require('../config/db');

async function listVisibleUsers(tenantId, userId, isAdmin) {
  if (isAdmin) {
    return db('users').where({ tenant_id: tenantId }).select('id', 'email', 'full_name').orderBy('email');
  }

  const sharedGroupIds = (
    await db('user_groups').where({ tenant_id: tenantId, user_id: userId }).select('group_id')
  ).map((row) => row.group_id);

  if (sharedGroupIds.length === 0) {
    return db('users').where({ tenant_id: tenantId, id: userId }).select('id', 'email', 'full_name');
  }

  const groupMateIds = (
    await db('user_groups')
      .where({ tenant_id: tenantId })
      .whereIn('group_id', sharedGroupIds)
      .distinct('user_id')
  ).map((row) => row.user_id);

  const visibleIds = Array.from(new Set([userId, ...groupMateIds]));

  return db('users').where({ tenant_id: tenantId }).whereIn('id', visibleIds).select('id', 'email', 'full_name').orderBy('email');
}

async function listVisibleGroups(tenantId, userId, isAdmin) {
  if (isAdmin) {
    return db('groups').where({ tenant_id: tenantId }).select('id', 'name').orderBy('name');
  }

  return db('groups')
    .join('user_groups', 'user_groups.group_id', 'groups.id')
    .where({ 'user_groups.tenant_id': tenantId, 'user_groups.user_id': userId })
    .select('groups.id', 'groups.name')
    .orderBy('groups.name');
}

module.exports = { listVisibleUsers, listVisibleGroups };
```

- [ ] **Step 4: Write the route files and mount them**

```javascript
// backend/src/routes/users.js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { listVisibleUsers } = require('../services/visibilityService');

const router = express.Router();

router.use(authenticate);

router.get('/visible', async (req, res, next) => {
  try {
    res.status(200).json(await listVisibleUsers(req.user.tenantId, req.user.userId, req.user.isAdmin));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

```javascript
// backend/src/routes/groups.js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { listVisibleGroups } = require('../services/visibilityService');

const router = express.Router();

router.use(authenticate);

router.get('/visible', async (req, res, next) => {
  try {
    res.status(200).json(await listVisibleGroups(req.user.tenantId, req.user.userId, req.user.isAdmin));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

In `backend/src/app.js`, add near the other route requires:

```javascript
const usersRouter = require('./routes/users');
const groupsRouter = require('./routes/groups');
```

and near `app.use('/document-types', documentTypesPublicRouter);` add:

```javascript
app.use('/users', usersRouter);
app.use('/groups', groupsRouter);
```

(Verified: `backend/src/middleware/auth.js` sets `req.user = { userId, tenantId, isAdmin }` — the field names used above are exactly right, no further check needed.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- visibility.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full backend test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/visibilityService.js backend/src/routes/users.js backend/src/routes/groups.js backend/src/app.js backend/tests/visibility.test.js
git commit -m "feat: add visibility-scoped user and group pickers"
```

---

## Task 5: Ticket number migration (trigger-based)

**Files:**
- Create: `backend/migrations/013_add_ticket_numbers.js`

**Interfaces:**
- Produces: table `tenant_ticket_counters` (`tenant_id` pk/fk, `next_number` integer default 1); column `workflow_instances.ticket_number` (integer, not null, unique per tenant); a `BEFORE INSERT` trigger that fills `ticket_number` automatically via an atomic upsert on `tenant_ticket_counters` whenever a row is inserted without one.

- [ ] **Step 1: Write the migration**

```javascript
exports.up = async function up(knex) {
  await knex.schema.createTable('tenant_ticket_counters', (table) => {
    table.uuid('tenant_id').primary().references('id').inTable('tenants').onDelete('CASCADE');
    table.integer('next_number').notNullable().defaultTo(1);
  });

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.integer('ticket_number');
  });

  await knex.raw(`
    CREATE OR REPLACE FUNCTION assign_ticket_number()
    RETURNS TRIGGER AS $$
    DECLARE
      v_ticket INTEGER;
    BEGIN
      IF NEW.ticket_number IS NULL THEN
        INSERT INTO tenant_ticket_counters (tenant_id, next_number)
        VALUES (NEW.tenant_id, 2)
        ON CONFLICT (tenant_id)
        DO UPDATE SET next_number = tenant_ticket_counters.next_number + 1
        RETURNING next_number - 1 INTO v_ticket;
        NEW.ticket_number := v_ticket;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER workflow_instances_assign_ticket_number
    BEFORE INSERT ON workflow_instances
    FOR EACH ROW
    EXECUTE FUNCTION assign_ticket_number();
  `);

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.integer('ticket_number').notNullable().alter();
    table.unique(['tenant_id', 'ticket_number']);
  });
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS workflow_instances_assign_ticket_number ON workflow_instances');
  await knex.raw('DROP FUNCTION IF EXISTS assign_ticket_number');
  await knex.schema.alterTable('workflow_instances', (table) => {
    table.dropUnique(['tenant_id', 'ticket_number']);
    table.dropColumn('ticket_number');
  });
  await knex.schema.dropTableIfExists('tenant_ticket_counters');
};
```

- [ ] **Step 2: Run the migration**

Run: `npm run migrate`
Expected: `Batch N run: 1 migrations` including `013_add_ticket_numbers.js`, no errors. If it fails on `alter().notNullable()` because `pg` requires the `knex` alter-column extension, confirm `knex.schema.alterTable(...).alter()` works in this project by checking whether any existing migration already uses `.alter()`; if none do, split the final `notNullable()` step into raw SQL instead: `ALTER TABLE workflow_instances ALTER COLUMN ticket_number SET NOT NULL;` via `knex.raw`.

- [ ] **Step 3: Manually verify the trigger in a psql/knex console**

Run (from `backend/`, adjust to however this project opens a DB shell — check `.env`/`knexfile.js` for connection details): insert two rows into `workflow_instances` for the same `tenant_id` without specifying `ticket_number` (using existing seeded fixture IDs, or via `node -e` with the `db` module) and confirm they get sequential ticket numbers `1` and `2`, and that a third insert for a *different* `tenant_id` also starts at `1`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/013_add_ticket_numbers.js
git commit -m "feat: add tenant-scoped ticket numbers via insert trigger"
```

---

## Task 6: Ticket number integration test

**Files:**
- Test: `backend/tests/ticketNumbers.test.js`

**Interfaces:**
- Consumes: `startInstance` from `../src/services/workflowInstanceService` (existing), plus whatever fixture setup that function needs (document type, workflow template with a stage, template file with a version) — follow the exact fixture pattern used in `backend/tests/instances.startAndGet.test.js` for creating those prerequisite rows.

- [ ] **Step 1: Read the existing fixture pattern**

Open `backend/tests/instances.startAndGet.test.js` and copy its `beforeAll` fixture setup (tenant, user, template file + version, workflow template + stage, document type) verbatim, changing only the UUID prefix to avoid collisions (use `af000000-...`).

- [ ] **Step 2: Write the failing test**

```javascript
// backend/tests/ticketNumbers.test.js
// beforeAll/afterAll: copy the fixture setup from instances.startAndGet.test.js,
// using UUID prefix 'af000000-0000-0000-0000-00000000000X' to avoid collisions,
// producing a DOCUMENT_TYPE_ID and USER_ID in this tenant.
const { startInstance } = require('../src/services/workflowInstanceService');

// ... (fixture setup as described in Step 1) ...

describe('ticket numbers', () => {
  it('assigns sequential ticket numbers within a tenant', async () => {
    const first = await startInstance(TENANT_ID, USER_ID, DOCUMENT_TYPE_ID);
    const second = await startInstance(TENANT_ID, USER_ID, DOCUMENT_TYPE_ID);
    expect(typeof first.ticket_number).toBe('number');
    expect(second.ticket_number).toBe(first.ticket_number + 1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails or passes for the wrong reason**

Run: `npm test -- ticketNumbers.test.js`
Expected: if Task 5 was done correctly this should already PASS, since the trigger requires no application code changes — this step confirms that. If it fails, the trigger migration (Task 5) has a bug; fix the migration, not this test.

- [ ] **Step 4: Run the full backend test suite**

Run: `npm test`
Expected: all tests PASS, including every pre-existing test that inserts into `workflow_instances` directly — confirming the trigger doesn't break any existing fixture.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/ticketNumbers.test.js
git commit -m "test: verify sequential ticket numbers on workflow instance creation"
```

---

## Task 7: Frontend — Groups API client and admin pages

**Files:**
- Create: `frontend/src/api/groups.ts`
- Create: `frontend/src/pages/admin/GroupsPage.tsx`
- Create: `frontend/src/pages/admin/GroupDetailPage.tsx`
- Modify: `frontend/src/App.tsx` — register the two new routes
- Modify: `frontend/src/components/Layout.tsx` — add a "Groups" nav link

**Interfaces:**
- Consumes: `apiFetch` from `./client` (existing pattern from `frontend/src/api/roles.ts`/`workflowTemplates.ts`).
- Produces:
  - `AdminGroup { id: string; name: string; memberCount: number }`
  - `AdminGroupDetail extends AdminGroup { members: { id: string; email: string; full_name: string | null }[] }`
  - `listGroups(): Promise<AdminGroup[]>`
  - `getGroup(id: string): Promise<AdminGroupDetail>`
  - `createGroup(name: string): Promise<AdminGroup>`
  - `renameGroup(id: string, name: string): Promise<AdminGroup>`
  - `deleteGroup(id: string): Promise<void>`
  - `addGroupMember(id: string, userId: string): Promise<void>`
  - `removeGroupMember(id: string, userId: string): Promise<void>`

- [ ] **Step 1: Write `frontend/src/api/groups.ts`**

```typescript
import { apiFetch } from './client';

export interface AdminGroup {
  id: string;
  name: string;
  memberCount: number;
}

export interface GroupMember {
  id: string;
  email: string;
  full_name: string | null;
}

export interface AdminGroupDetail extends AdminGroup {
  members: GroupMember[];
}

export function listGroups(): Promise<AdminGroup[]> {
  return apiFetch('/admin/groups');
}

export function getGroup(id: string): Promise<AdminGroupDetail> {
  return apiFetch(`/admin/groups/${id}`);
}

export function createGroup(name: string): Promise<AdminGroup> {
  return apiFetch('/admin/groups', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameGroup(id: string, name: string): Promise<AdminGroup> {
  return apiFetch(`/admin/groups/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

export function deleteGroup(id: string): Promise<void> {
  return apiFetch(`/admin/groups/${id}`, { method: 'DELETE' });
}

export function addGroupMember(id: string, userId: string): Promise<void> {
  return apiFetch(`/admin/groups/${id}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId }) });
}

export function removeGroupMember(id: string, userId: string): Promise<void> {
  return apiFetch(`/admin/groups/${id}/members/${userId}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Write `frontend/src/pages/admin/GroupsPage.tsx`**

Follow `frontend/src/pages/admin/WorkflowTemplatesPage.tsx` exactly (list + create form), swapping in the group API and showing `memberCount`:

```tsx
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createGroup, listGroups } from '../../api/groups';
import { ApiError } from '../../api/client';

export function GroupsPage() {
  const queryClient = useQueryClient();
  const { data: groups, isLoading } = useQuery({ queryKey: ['groups'], queryFn: listGroups });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create group'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate(name);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Groups</h1>

      <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          required
          placeholder="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {groups?.map((group) => (
          <li key={group.id} className="px-4 py-3 text-sm">
            <Link to={`/admin/groups/${group.id}`} className="text-blue-700 hover:underline">
              {group.name}
            </Link>
            <span className="ml-2 text-gray-500">({group.memberCount} members)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Write `frontend/src/pages/admin/GroupDetailPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addGroupMember, getGroup, removeGroupMember } from '../../api/groups';
import { listUsers } from '../../api/users';
import { ApiError } from '../../api/client';

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', id],
    queryFn: () => getGroup(id!),
    enabled: Boolean(id),
  });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: listUsers });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['group', id] });
  }

  const addMutation = useMutation({
    mutationFn: () => addGroupMember(id!, selectedUserId),
    onSuccess: () => {
      setSelectedUserId('');
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to add member'),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeGroupMember(id!, userId),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to remove member'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    addMutation.mutate();
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!group) return <p className="text-sm text-red-700">Group not found.</p>;

  const memberIds = new Set(group.members.map((m) => m.id));
  const availableUsers = users?.filter((u) => !memberIds.has(u.id)) ?? [];

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{group.name}</h1>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Members</h2>
      <ul className="mb-6 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {group.members.map((member) => (
          <li key={member.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{member.full_name ? `${member.full_name} (${member.email})` : member.email}</span>
            <button
              onClick={() => removeMutation.mutate(member.id)}
              disabled={removeMutation.isPending}
              className="text-sm text-red-700 hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
        {group.members.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No members yet.</li>}
      </ul>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Add member</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <select
          required
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select a user</option>
          {availableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name ? `${user.full_name} (${user.email})` : user.email}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Register the routes in `App.tsx`**

Add imports:

```tsx
import { GroupsPage } from './pages/admin/GroupsPage';
import { GroupDetailPage } from './pages/admin/GroupDetailPage';
```

Add inside the existing `<Route element={<AdminRoute />}>` block, alongside the other `/admin/*` routes:

```tsx
<Route path="/admin/groups" element={<GroupsPage />} />
<Route path="/admin/groups/:id" element={<GroupDetailPage />} />
```

- [ ] **Step 5: Add the nav link in `Layout.tsx`**

Inside the `{decoded?.isAdmin && (...)}` block, alongside the other admin `NavLink`s:

```tsx
<NavLink to="/admin/groups" className={linkClass}>
  Groups
</NavLink>
```

- [ ] **Step 6: Manually verify in the browser**

Run (from `frontend/`): `npm run dev`, log in as an admin, navigate to Groups, create a group, open it, add and remove a member, rename it from the list is not available (rename is not wired to a UI button in this task — confirm that's acceptable, since the spec doesn't require a rename UI beyond the API existing; if it looks obviously missing, that's fine per the design's frontend section which doesn't call out rename as a required UI action, only the API).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/groups.ts frontend/src/pages/admin/GroupsPage.tsx frontend/src/pages/admin/GroupDetailPage.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat: add admin Groups pages"
```

---

## Task 8: Frontend — display ticket numbers

**Files:**
- Modify: `frontend/src/api/instances.ts` — add `ticket_number` to `WorkflowInstance`
- Modify: `frontend/src/pages/MyTasksPage.tsx` — show the ticket number on each task card
- Modify: `frontend/src/pages/InstanceDetailPage.tsx` — show the ticket number in the header

**Interfaces:**
- Consumes: `WorkflowInstance` (existing interface in `frontend/src/api/instances.ts`).
- Produces: `WorkflowInstance.ticket_number: number` (new field); a small shared formatting convention `WF-<ticket_number padded to 6 digits>` inlined at each of the two display sites (no new shared helper needed for two call sites).

- [ ] **Step 1: Add the field to the `WorkflowInstance` interface**

In `frontend/src/api/instances.ts`, inside the `WorkflowInstance` interface, add:

```typescript
  ticket_number: number;
```

(placed alongside the other existing fields, e.g. right after `id: string;`).

- [ ] **Step 2: Show it on `MyTasksPage.tsx`**

In the `TaskCard` component, change:

```tsx
      <div className="font-medium text-gray-900">{task.document_type_name}</div>
```

to:

```tsx
      <div className="font-medium text-gray-900">
        WF-{String(task.ticket_number).padStart(6, '0')} — {task.document_type_name}
      </div>
```

- [ ] **Step 3: Show it on `InstanceDetailPage.tsx`**

Change:

```tsx
      <h1 className="mb-1 text-xl font-bold">
        {history?.documentType.name ?? 'Instance'}
      </h1>
```

to:

```tsx
      <h1 className="mb-1 text-xl font-bold">
        WF-{String(instance.ticket_number).padStart(6, '0')} — {history?.documentType.name ?? 'Instance'}
      </h1>
```

- [ ] **Step 4: Manually verify in the browser**

Run (from `frontend/`): `npm run dev`. Log in, start a new document instance, confirm its ticket number (e.g. `WF-000001`) appears both on the My Tasks card and on the instance detail page header, and increments on the next instance you start.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/instances.ts frontend/src/pages/MyTasksPage.tsx frontend/src/pages/InstanceDetailPage.tsx
git commit -m "feat: display workflow ticket numbers in the UI"
```

---

## Self-review notes (for the plan author, already applied above)

- **Spec coverage:** §2 groups/membership → Tasks 1-3, 7. §3 visibility rule → Task 4. §2/§4 ticket numbers → Tasks 5-6, 8. §6 out-of-scope items (group-assignable stages, ad-hoc workflows, comments, ticket-number search) are correctly not touched by any task here.
- **Type consistency:** `AdminGroup`/`AdminGroupDetail` field names match between `groupService.js`'s returned shape (`id`, `name`, `memberCount`, `members: {id, email, full_name}`) and the frontend `frontend/src/api/groups.ts` interfaces.
- **No placeholders:** every step includes runnable code; Task 4 Step 4's note about confirming `req.user` field names is a verification instruction (read one existing file), not a deferred implementation decision — the field names it must match are already used consistently by every other route in the codebase.
