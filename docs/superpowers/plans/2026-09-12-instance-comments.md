# Workflow Instance Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flat, unthreaded comment thread on a workflow instance, visible and postable only by people with a stake in it (creator, past actors, current assignee, admins), with email notifications to everyone else involved.

**Architecture:** A new `comments` table and a new, small `commentService.js` (separate from the already-534-line `workflowInstanceService.js`) that reuses `getInstanceDetail` for instance/stage resolution and `canAct` for authorization, adding one new `isInvolvedInInstance` check shared by both listing and posting. Notifications reuse `notificationService`'s existing per-stage email resolution, extended with one new generic "email this exact set of addresses" function.

**Tech Stack:** Node.js/Express/Knex/PostgreSQL backend, React/TypeScript/Vite frontend, Jest+Supertest backend tests, `tsc -b` for frontend verification (no frontend test framework in this repo).

**Spec:** `docs/superpowers/specs/2026-09-12-comments-design.md`

## Global Constraints

- Comments are permanent once posted — no edit, no delete (spec §2, §7).
- "Involved" (for both reading and posting) = admin, OR the instance's creator, OR anyone who appears as `actor_id` in that instance's `stage_actions`, OR whoever can currently act on it (`canAct`), OR — if the current stage is unclaimed and role/group-assigned — anyone eligible to claim it (spec §3).
- Comment notification recipients = creator + distinct past actors + current stage's resolved assignee(s), **excluding the comment's own author**, and admins are **not** auto-notified merely for being admins (spec §5).
- No comment-text excerpt in the notification email body/subject (spec §5).
- `GET /instances/:id` (the existing, broader, unauthorized endpoint) is unchanged — comments get their own stricter gate (spec §3, §7).
- Every backend change must keep the full existing test suite passing.

---

## Task 1: Migration — `comments` table

**Files:**
- Create: `backend/migrations/017_create_comments.js`
- Test: `backend/tests/commentsSchema.test.js`

**Interfaces:**
- Produces: `comments` table — `id` (uuid pk), `tenant_id` (uuid, FK → `tenants`), `workflow_instance_id` (uuid, composite FK `(tenant_id, workflow_instance_id)` → `workflow_instances(tenant_id, id)`, `ON DELETE CASCADE`), `author_id` (uuid, composite FK `(tenant_id, author_id)` → `users(tenant_id, id)`), `body` (text, not null), `created_at` (timestamp, not null, default `now()`).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/commentsSchema.test.js
const db = require('../src/config/db');

describe('comments table schema', () => {
  afterAll(async () => {
    await db.destroy();
  });

  it('has the expected columns and nullability', async () => {
    const hasTable = await db.schema.hasTable('comments');
    expect(hasTable).toBe(true);

    const columnInfo = await db('comments').columnInfo();
    expect(columnInfo.id.nullable).toBe(false);
    expect(columnInfo.tenant_id.nullable).toBe(false);
    expect(columnInfo.workflow_instance_id.nullable).toBe(false);
    expect(columnInfo.author_id.nullable).toBe(false);
    expect(columnInfo.body.nullable).toBe(false);
    expect(columnInfo.created_at.nullable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/commentsSchema.test.js`
Expected: FAIL — `db.schema.hasTable('comments')` is `false` (table doesn't exist yet).

- [ ] **Step 3: Write the migration**

```js
// backend/migrations/017_create_comments.js
exports.up = async function up(knex) {
  await knex.schema.createTable('comments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('workflow_instance_id').notNullable();
    table.uuid('author_id').notNullable();
    table.text('body').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('tenant_id');
    table.index('workflow_instance_id');

    table
      .foreign(['tenant_id', 'workflow_instance_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.foreign(['tenant_id', 'author_id']).references(['tenant_id', 'id']).inTable('users');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('comments');
};
```

- [ ] **Step 4: Run migrations and the test again to verify it passes**

Run: `cd backend && npx cross-env NODE_ENV=test npx knex migrate:latest && npx cross-env NODE_ENV=test npx jest tests/commentsSchema.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full existing suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all existing suites plus this new one (currently 45 suites / 173 tests before this task).

- [ ] **Step 6: Apply the migration to the dev database too**

Run: `cd backend && npx knex migrate:latest`

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/017_create_comments.js backend/tests/commentsSchema.test.js
git commit -m "feat: add comments table for workflow instance discussion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Backend — `commentService`, notification wiring, and routes

**Files:**
- Create: `backend/src/services/commentService.js`
- Modify: `backend/src/services/notificationService.js`
- Modify: `backend/src/routes/instances.js`
- Test: Create `backend/tests/instances.comments.test.js`

**Interfaces:**
- Consumes: `comments` table (Task 1); `getInstanceDetail(tenantId, instanceId)` from `backend/src/services/workflowInstanceService.js` (returns `{ instance, documentType, stage }`); `canAct(stage, instance, userId)` from `backend/src/utils/workflowAuthorization.js`; `assertRequiredString(value, fieldName)` from `backend/src/utils/validation.js`.
- Produces: `commentService.listComments(tenantId, userId, isAdmin, instanceId)` → `Promise<Array<{ id, author_id, author_name, body, created_at }>>`; `commentService.addComment(tenantId, userId, isAdmin, instanceId, body)` → `Promise<{ id, author_id, author_name, body, created_at }>`; `commentService.isInvolvedInInstance(tenantId, instance, stage, userId, isAdmin)` → `Promise<boolean>` (exported for the test file to reuse if needed, and so a later task could reuse it without duplicating the check). `notificationService.notifyEmails(tenantId, workflowInstanceId, templateName, emails, context)` and `notificationService.resolveStageRecipientEmails(tenantId, stage)` (newly exported, the latter already existed internally).

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/instances.comments.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'e1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'e1000000-0000-0000-0000-000000000002';
const CREATOR_ID = 'e1000000-0000-0000-0000-000000000003';
const ACTOR_ID = 'e1000000-0000-0000-0000-000000000004';
const GROUP_MEMBER_ID = 'e1000000-0000-0000-0000-000000000005';
const OUTSIDER_ID = 'e1000000-0000-0000-0000-000000000006';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const creatorToken = signToken({ sub: CREATOR_ID, tenant_id: TENANT_ID, is_admin: false });
const actorToken = signToken({ sub: ACTOR_ID, tenant_id: TENANT_ID, is_admin: false });
const groupMemberToken = signToken({ sub: GROUP_MEMBER_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('workflow instance comments', () => {
  let instanceId;
  let creatorEmail;
  let actorEmail;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Comments Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'comments-admin@example.com', password_hash: 'x', is_admin: true },
        { id: CREATOR_ID, tenant_id: TENANT_ID, email: 'comments-creator@example.com', password_hash: 'x' },
        { id: ACTOR_ID, tenant_id: TENANT_ID, email: 'comments-actor@example.com', password_hash: 'x' },
        { id: GROUP_MEMBER_ID, tenant_id: TENANT_ID, email: 'comments-groupmember@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'comments-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    creatorEmail = 'comments-creator@example.com';
    actorEmail = 'comments-actor@example.com';

    const group = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Comments Review Group' });
    await request(app)
      .post(`/admin/groups/${group.body.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: GROUP_MEMBER_ID });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Comments Memo Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Comments Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ACTOR_ID });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 2, name: 'Review', assigneeType: 'group', assigneeGroupId: group.body.id });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comments Memo',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });

    const startResponse = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = startResponse.body.id;
  });

  afterAll(async () => {
    await db('comments').where({ tenant_id: TENANT_ID }).del();
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects reading and posting comments from an uninvolved user', async () => {
    const getResponse = await request(app)
      .get(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(getResponse.status).toBe(403);

    const postResponse = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ body: 'Should not be allowed' });
    expect(postResponse.status).toBe(403);
  });

  it('allows the creator to post and read a comment', async () => {
    const postResponse = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ body: 'Please review by Friday' });
    expect(postResponse.status).toBe(201);
    expect(postResponse.body.body).toBe('Please review by Friday');
    expect(postResponse.body.author_name).toBeTruthy();

    const getResponse = await request(app)
      .get(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.some((c) => c.body === 'Please review by Friday')).toBe(true);
  });

  it("allows the current stage's directly assigned user to post a comment", async () => {
    // At this point the instance is still at stage 1 (Draft), directly
    // assigned to ACTOR_ID — this exercises the canAct()-based involvement
    // check specifically, before ACTOR_ID becomes a past actor below.
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ body: 'Drafting now' });
    expect(response.status).toBe(201);
  });

  it('forwards the instance from stage 1 to stage 2 (Review, group-assigned, unclaimed)', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.current_stage_order).toBe(2);
  });

  it('allows a past actor to post a comment after their stage has moved on', async () => {
    // Now that the instance has moved to stage 2, ACTOR_ID is no longer the
    // current assignee — this exercises the stage_actions-actor involvement
    // check instead of canAct().
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ body: 'Forwarded to review' });
    expect(response.status).toBe(201);
  });

  it('allows an unclaimed group-eligible member to post a comment', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${groupMemberToken}`)
      .send({ body: 'On it' });
    expect(response.status).toBe(201);
  });

  it('allows an admin with no other relationship to post a comment', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Admin checking in' });
    expect(response.status).toBe(201);
  });

  it('rejects an empty comment body', async () => {
    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ body: '   ' });
    expect(response.status).toBe(400);
  });

  it("notifies the creator and past actor but not the comment's own author", async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();

    const response = await request(app)
      .post(`/instances/${instanceId}/comments`)
      .set('Authorization', `Bearer ${groupMemberToken}`)
      .send({ body: 'Notification check' });
    expect(response.status).toBe(201);

    const notifications = await db('notifications').where({ tenant_id: TENANT_ID });
    const recipientEmails = notifications.map((n) => n.recipient_email);
    expect(recipientEmails).toContain(creatorEmail);
    expect(recipientEmails).toContain(actorEmail);
    expect(recipientEmails).not.toContain('comments-groupmember@example.com');
    expect(notifications.every((n) => n.subject.startsWith('New comment:'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/instances.comments.test.js`
Expected: FAIL — `GET`/`POST /instances/:id/comments` don't exist yet (404s, not the 403/201/400 the tests expect).

- [ ] **Step 3: Add `notifyEmails` and export `resolveStageRecipientEmails` from `notificationService.js`**

Add this new template to the existing `TEMPLATES` object in `backend/src/services/notificationService.js` (alongside `assigned`, `forwarded`, etc.):

```js
  commented: ({ documentTypeName, authorName }) => ({
    subject: `New comment: ${documentTypeName}`,
    body: `${authorName} commented on "${documentTypeName}".`,
  }),
```

Add this new function after `notifyUser`:

```js
async function notifyEmails(tenantId, workflowInstanceId, templateName, emails, context) {
  const { subject, body } = TEMPLATES[templateName](context);
  await Promise.all(emails.map((email) => enqueueNotification(tenantId, workflowInstanceId, email, subject, body)));
}
```

Change the final export line to also export `resolveStageRecipientEmails` and the new `notifyEmails`:

```js
module.exports = { notifyStage, notifyUser, notifyEmails, resolveStageRecipientEmails, TEMPLATES };
```

- [ ] **Step 4: Create `backend/src/services/commentService.js`**

```js
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertRequiredString } = require('../utils/validation');
const { canAct } = require('../utils/workflowAuthorization');
const { getInstanceDetail } = require('./workflowInstanceService');
const { notifyEmails, resolveStageRecipientEmails } = require('./notificationService');

async function isInvolvedInInstance(tenantId, instance, stage, userId, isAdmin) {
  if (isAdmin) {
    return true;
  }
  if (instance.created_by === userId) {
    return true;
  }

  const hasActed = await db('stage_actions')
    .where({ tenant_id: tenantId, workflow_instance_id: instance.id, actor_id: userId })
    .first();
  if (hasActed) {
    return true;
  }

  if (canAct(stage, instance, userId)) {
    return true;
  }

  if (!instance.claimed_by) {
    if (stage.assignee_type === 'role') {
      const hasRole = await db('user_roles')
        .where({ tenant_id: tenantId, user_id: userId, role_id: stage.assignee_role_id })
        .first();
      if (hasRole) {
        return true;
      }
    }
    if (stage.assignee_type === 'group') {
      const isMember = await db('user_groups')
        .where({ tenant_id: tenantId, user_id: userId, group_id: stage.assignee_group_id })
        .first();
      if (isMember) {
        return true;
      }
    }
  }

  return false;
}

function toCommentDto(row) {
  return {
    id: row.id,
    author_id: row.author_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at,
  };
}

async function listComments(tenantId, userId, isAdmin, instanceId) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);
  if (!(await isInvolvedInInstance(tenantId, instance, stage, userId, isAdmin))) {
    throw new AppError(403, 'You are not involved in this workflow instance');
  }

  const rows = await db('comments')
    .join('users', 'users.id', 'comments.author_id')
    .where({ 'comments.tenant_id': tenantId, 'comments.workflow_instance_id': instanceId })
    .orderBy('comments.created_at', 'asc')
    .select(
      'comments.id',
      'comments.author_id',
      db.raw('COALESCE(users.full_name, users.email) as author_name'),
      'comments.body',
      'comments.created_at',
    );

  return rows.map(toCommentDto);
}

async function addComment(tenantId, userId, isAdmin, instanceId, body) {
  const { instance, stage, documentType } = await getInstanceDetail(tenantId, instanceId);
  if (!(await isInvolvedInInstance(tenantId, instance, stage, userId, isAdmin))) {
    throw new AppError(403, 'You are not involved in this workflow instance');
  }
  assertRequiredString(body, 'body');

  const [inserted] = await db('comments')
    .insert({ tenant_id: tenantId, workflow_instance_id: instanceId, author_id: userId, body })
    .returning('*');

  const author = await db('users').where({ tenant_id: tenantId, id: userId }).first();

  const recipientEmails = new Set();

  const creator = await db('users').where({ tenant_id: tenantId, id: instance.created_by }).first();
  if (creator) {
    recipientEmails.add(creator.email);
  }

  const actorRows = await db('stage_actions')
    .join('users', 'users.id', 'stage_actions.actor_id')
    .where({ 'stage_actions.tenant_id': tenantId, 'stage_actions.workflow_instance_id': instanceId })
    .distinct('users.email')
    .select('users.email');
  actorRows.forEach((row) => recipientEmails.add(row.email));

  const stageEmails = await resolveStageRecipientEmails(tenantId, stage);
  stageEmails.forEach((email) => recipientEmails.add(email));

  recipientEmails.delete(author.email);

  await notifyEmails(tenantId, instanceId, 'commented', Array.from(recipientEmails), {
    documentTypeName: documentType.name,
    authorName: author.full_name || author.email,
  });

  return toCommentDto({
    id: inserted.id,
    author_id: inserted.author_id,
    author_name: author.full_name || author.email,
    body: inserted.body,
    created_at: inserted.created_at,
  });
}

module.exports = { listComments, addComment, isInvolvedInInstance };
```

- [ ] **Step 5: Wire the routes in `backend/src/routes/instances.js`**

Add to the existing `require('../services/workflowInstanceService')` block's neighbors — a new require line right after it:

```js
const { listComments, addComment } = require('../services/commentService');
```

Add these two routes (placement: anywhere after `router.use(authenticate);`, e.g. right before the `router.get('/:id/history', ...)` block):

```js
router.get('/:id/comments', async (req, res, next) => {
  try {
    const comments = await listComments(req.user.tenantId, req.user.userId, req.user.isAdmin, req.params.id);
    res.status(200).json(comments);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    const comment = await addComment(
      req.user.tenantId,
      req.user.userId,
      req.user.isAdmin,
      req.params.id,
      req.body.body,
    );
    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/instances.comments.test.js`
Expected: PASS — all 9 `it` blocks.

- [ ] **Step 7: Run the full suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — every existing suite plus the two new ones from this plan (45 + 2 suites, 173 + ~8 tests before this task's own count).

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/commentService.js backend/src/services/notificationService.js backend/src/routes/instances.js backend/tests/instances.comments.test.js
git commit -m "feat: add comment thread endpoints with involvement-based access and notifications

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — comments API and UI section

**Files:**
- Create: `frontend/src/api/comments.ts`
- Modify: `frontend/src/pages/InstanceDetailPage.tsx`

**Interfaces:**
- Consumes: `GET /instances/:id/comments`, `POST /instances/:id/comments` (Task 2). `apiFetch`, `ApiError` from `frontend/src/api/client.ts` (existing pattern used by every other api file in this project).
- Produces: `InstanceComment` type, `listComments(instanceId)`, `addComment(instanceId, body)` — consumed only by `InstanceDetailPage.tsx` in this plan, but exported for any future page that also wants to show comments.

- [ ] **Step 1: Create `frontend/src/api/comments.ts`**

```ts
import { apiFetch } from './client';

export interface InstanceComment {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export function listComments(instanceId: string): Promise<InstanceComment[]> {
  return apiFetch(`/instances/${instanceId}/comments`);
}

export function addComment(instanceId: string, body: string): Promise<InstanceComment> {
  return apiFetch(`/instances/${instanceId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}
```

- [ ] **Step 2: Add the Comments section to `InstanceDetailPage.tsx`**

Add to the import block at the top (new import line, keep the existing `../api/instances` import as-is):

```tsx
import { addComment, listComments } from '../api/comments';
```

Add new state right after the existing `const [comment, setComment] = useState('');` line:

```tsx
  const [commentBody, setCommentBody] = useState('');
```

Add a new query, anywhere alongside the existing `useQuery` calls (e.g. right after the `history` query):

```tsx
  const { data: instanceComments } = useQuery({
    queryKey: ['instanceComments', id],
    queryFn: () => listComments(id!),
    enabled: Boolean(id),
    retry: false,
  });
```

(`retry: false` — a 403 here means "not involved," which is an expected steady state, not a transient failure worth retrying.)

Add a new mutation alongside the existing mutations (e.g. right after `saveContentMutation`):

```tsx
  const addCommentMutation = useMutation({
    mutationFn: (body: string) => addComment(id!, body),
    onSuccess: () => {
      setCommentBody('');
      queryClient.invalidateQueries({ queryKey: ['instanceComments', id] });
    },
    onError: (err) => onError(err, 'Failed to post comment'),
  });
```

Add the Comments section to the JSX, in the left column, right after the closing `</ul>` of the existing "Audit Log" block (still inside the `<div className="max-w-2xl flex-shrink-0 lg:w-[28rem]">` column, before its closing `</div>`):

```tsx
        {instanceComments && (
          <>
            <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Comments</h2>
            <ul className="mb-3 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
              {instanceComments.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  <span className="font-medium">{c.author_name}</span>
                  {' — '}
                  {new Date(c.created_at).toLocaleString()}
                  <p className="mt-1 text-gray-700">{c.body}</p>
                </li>
              ))}
              {instanceComments.length === 0 && (
                <li className="px-4 py-3 text-sm text-gray-500">No comments yet.</li>
              )}
            </ul>
            <div className="flex gap-2">
              <input
                type="text"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Add a comment"
                className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={() => addCommentMutation.mutate(commentBody)}
                disabled={addCommentMutation.isPending || commentBody.trim().length === 0}
                className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Post
              </button>
            </div>
          </>
        )}
```

(When the query 403s, `instanceComments` stays `undefined` and the whole section renders nothing — matching spec §6's "not involved is an expected, non-error state.")

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no output (clean compile).

- [ ] **Step 4: Manual verification**

With both dev servers running: open a workflow instance as its creator, confirm the Comments section appears with an empty-state message and posting a comment works and shows up immediately. Open the same instance as a tenant user with no relationship to it (a fresh user in no group, never acted on it) and confirm the Comments section doesn't render at all. Open it as an admin with no other relationship and confirm they can also see and post.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/comments.ts frontend/src/pages/InstanceDetailPage.tsx
git commit -m "feat: show and post workflow instance comments in the UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
