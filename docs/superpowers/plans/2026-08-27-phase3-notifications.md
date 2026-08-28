# Phase 3 — Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every workflow transition (assigned, forwarded, sent back, rejected, completed, reassigned) enqueues an email notification instead of sending inline, and a background worker polls and sends them with capped retry, so an SMTP outage delays delivery instead of silently dropping it.

**Architecture:** A `notificationService.js` owns recipient resolution and email content (per-event templates) and only ever inserts rows into the existing `notifications` table — it never calls SMTP directly. A separate `notificationWorker.js` polls `WHERE status = 'pending'`, attempts delivery through a Nodemailer transporter, and updates `status`/`attempts`/`last_error`. `workflowInstanceService.js`'s existing transition functions (Phase 2) call the notification service at the same point they already write `stage_actions` — enqueueing is a side effect of the transition, not a separate API.

**Tech Stack:** Adds `nodemailer` (Spec §9: "Email: SMTP via Nodemailer, queued and retried"). No other new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`

## Global Constraints

- Notifications are never sent inline during a request — every event enqueues a `notifications` row; only the background worker sends. (Spec §5.4)
- Retry is capped (`MAX_ATTEMPTS`); once exhausted, the row's `status` becomes `'failed'` rather than retrying forever, and `last_error` always holds the most recent failure detail for diagnosis. (Spec §9 "Failure handling")
- The worker polls `notifications` by `status` — already indexed for this in Phase 0 (`notifications(status)`). (Spec §6.3)
- Every notification still carries `tenant_id` (already required by the schema) even though the worker itself processes all tenants' pending rows in one pass — it is an internal batch job, not a per-request handler, so it is not a tenant-isolation violation for it to see every tenant's queue.
- The worker's `sendMail` function is injectable so tests can simulate a failing SMTP transport without any real network call — this is what makes "a simulated SMTP outage is retried, not dropped" testable at all. (Spec §9 exit criterion)

---

## Task 1: SMTP config and Nodemailer transporter

**Files:**
- Modify: `backend/package.json` (add `nodemailer` dependency)
- Modify: `backend/src/config/env.js` (add `smtp` to the returned config)
- Modify: `backend/tests/env.test.js` (extend the "fully-populated config" assertion)
- Modify: `backend/.env.example` (document the new SMTP variables)
- Create: `backend/src/config/mailer.js`

**Interfaces:**
- Produces: `transporter` (a Nodemailer transport instance) and `MAIL_FROM` (string), exported from `mailer.js`. Task 4's worker consumes both.

- [ ] **Step 1: Add `nodemailer` to `backend/package.json` dependencies**

Add to the `dependencies` block (alphabetical order):
```json
    "nodemailer": "^6.9.13",
```

Run: `cd "d:\Project\Workflow Managment System\backend" && npm install`
Expected: installs cleanly, no vulnerabilities reported.

- [ ] **Step 2: Add SMTP variables to `backend/.env.example`**

Add after `STORAGE_DIR`:
```dotenv
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=no-reply@example.com
```
Add the same block to the real `backend/.env` (leave `SMTP_USER`/`SMTP_PASSWORD` blank for local dev — no real mail server is required for this phase's own test suite).

- [ ] **Step 3: Extend the failing test first**

In `backend/tests/env.test.js`, add an assertion to "returns a fully-populated config object for valid input", right after the `storageDir` line:

```js
    expect(config.smtp).toEqual({
      host: 'localhost',
      port: 587,
      secure: false,
      user: '',
      password: '',
      from: 'no-reply@example.com',
    });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx jest tests/env.test.js`
Expected: FAIL — `config.smtp` is `undefined`.

- [ ] **Step 5: Update `backend/src/config/env.js`**

Add `smtp` to the returned object, right after `storageDir`:
```js
    smtp: {
      host: env.SMTP_HOST || 'localhost',
      port: parseInt(env.SMTP_PORT || '587', 10),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '',
      password: env.SMTP_PASSWORD || '',
      from: env.SMTP_FROM || 'no-reply@example.com',
    },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest tests/env.test.js`
Expected: PASS, all 6 tests green.

- [ ] **Step 7: Write `backend/src/config/mailer.js`**

```js
const nodemailer = require('nodemailer');
const { validateEnv } = require('./env');

const config = validateEnv();

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
});

module.exports = { transporter, MAIL_FROM: config.smtp.from };
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .env.example src/config/env.js src/config/mailer.js tests/env.test.js
git commit -m "feat: add SMTP config and Nodemailer transporter"
```

---

## Task 2: Notification service — recipient resolution, templates, enqueue

**Files:**
- Create: `backend/src/services/notificationService.js`
- Test: `backend/tests/notificationService.test.js`

**Interfaces:**
- Consumes: nothing new (uses `db` directly).
- Produces: `notifyStage(tenantId, workflowInstanceId, templateName, stage, context) -> Promise<void>` (enqueues one row per recipient resolved from the stage's assignee), `notifyUser(tenantId, workflowInstanceId, templateName, userId, context) -> Promise<void>` (enqueues one row for a specific user), `TEMPLATES` (object keyed by `assigned`/`forwarded`/`sent_back`/`rejected`/`completed`/`reassigned`, each `(context) -> { subject, body }`). Task 3 calls `notifyStage`/`notifyUser` from every transition.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/notificationService.test.js
const db = require('../src/config/db');
const { notifyStage, notifyUser, TEMPLATES } = require('../src/services/notificationService');

const TENANT_ID = 'd0000000-0000-0000-0000-000000000001';
const USER_A = 'd0000000-0000-0000-0000-000000000002';
const USER_B = 'd0000000-0000-0000-0000-000000000003';
// notifications.workflow_instance_id is a composite (tenant_id, id) FK to
// workflow_instances; passing null exercises the notification content/recipient
// logic here without needing a real instance row.
const INSTANCE_ID = null;

describe('notificationService', () => {
  let roleId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Notification Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: USER_A, tenant_id: TENANT_ID, email: 'notif-a@example.com', password_hash: 'x' },
        { id: USER_B, tenant_id: TENANT_ID, email: 'notif-b@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [role] = await db('roles').insert({ tenant_id: TENANT_ID, name: 'Reviewer' }).returning('id');
    roleId = role.id;
    await db('user_roles').insert([
      { tenant_id: TENANT_ID, user_id: USER_A, role_id: roleId },
      { tenant_id: TENANT_ID, user_id: USER_B, role_id: roleId },
    ]);
  });

  afterEach(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
  });

  afterAll(async () => {
    await db('user_roles').where({ tenant_id: TENANT_ID }).del();
    await db('roles').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('enqueues one notification for a user-assigned stage', async () => {
    const stage = { assignee_type: 'user', assignee_user_id: USER_A };
    await notifyStage(TENANT_ID, INSTANCE_ID, 'assigned', stage, {
      documentTypeName: 'SRS',
      stageName: 'Draft',
    });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_email).toBe('notif-a@example.com');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].subject).toBe(TEMPLATES.assigned({ documentTypeName: 'SRS', stageName: 'Draft' }).subject);
  });

  it('enqueues one notification per role-holder for a role-assigned stage', async () => {
    const stage = { assignee_type: 'role', assignee_role_id: roleId };
    await notifyStage(TENANT_ID, INSTANCE_ID, 'forwarded', stage, {
      documentTypeName: 'HR Letter',
      stageName: 'Review',
    });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID }).orderBy('recipient_email');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recipient_email)).toEqual(['notif-a@example.com', 'notif-b@example.com']);
  });

  it('enqueues a notification for a specific user', async () => {
    await notifyUser(TENANT_ID, INSTANCE_ID, 'rejected', USER_A, { documentTypeName: 'SRS', comment: 'Bad format' });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_email).toBe('notif-a@example.com');
    expect(rows[0].body).toContain('Bad format');
  });

  it('does nothing when the target user does not exist', async () => {
    await notifyUser(TENANT_ID, INSTANCE_ID, 'completed', '99999999-9999-9999-9999-999999999999', {
      documentTypeName: 'SRS',
    });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/notificationService.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `backend/src/services/notificationService.js`**

```js
const db = require('../config/db');

const TEMPLATES = {
  assigned: ({ documentTypeName, stageName }) => ({
    subject: `New task: ${documentTypeName} — ${stageName}`,
    body: `A new "${documentTypeName}" document has been assigned to you at the "${stageName}" stage.`,
  }),
  forwarded: ({ documentTypeName, stageName }) => ({
    subject: `Task forwarded to you: ${documentTypeName} — ${stageName}`,
    body: `"${documentTypeName}" has been forwarded to you at the "${stageName}" stage.`,
  }),
  sent_back: ({ documentTypeName, stageName }) => ({
    subject: `Task sent back: ${documentTypeName} — ${stageName}`,
    body: `"${documentTypeName}" has been sent back to you at the "${stageName}" stage.`,
  }),
  rejected: ({ documentTypeName, comment }) => ({
    subject: `Document rejected: ${documentTypeName}`,
    body: `Your "${documentTypeName}" submission was rejected.${comment ? ` Reason: ${comment}` : ''}`,
  }),
  completed: ({ documentTypeName }) => ({
    subject: `Workflow completed: ${documentTypeName}`,
    body: `Your "${documentTypeName}" submission has completed its workflow.`,
  }),
  reassigned: ({ documentTypeName, stageName }) => ({
    subject: `You've been assigned: ${documentTypeName} — ${stageName}`,
    body: `An admin has assigned you to act on "${documentTypeName}" at the "${stageName}" stage.`,
  }),
};

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

async function enqueueNotification(tenantId, workflowInstanceId, recipientEmail, subject, body) {
  await db('notifications').insert({
    tenant_id: tenantId,
    workflow_instance_id: workflowInstanceId,
    recipient_email: recipientEmail,
    subject,
    body,
    status: 'pending',
  });
}

async function notifyStage(tenantId, workflowInstanceId, templateName, stage, context) {
  const emails = await resolveStageRecipientEmails(tenantId, stage);
  const { subject, body } = TEMPLATES[templateName](context);
  await Promise.all(emails.map((email) => enqueueNotification(tenantId, workflowInstanceId, email, subject, body)));
}

async function notifyUser(tenantId, workflowInstanceId, templateName, userId, context) {
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    return;
  }
  const { subject, body } = TEMPLATES[templateName](context);
  await enqueueNotification(tenantId, workflowInstanceId, user.email, subject, body);
}

module.exports = { notifyStage, notifyUser, TEMPLATES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/notificationService.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/notificationService.js tests/notificationService.test.js
git commit -m "feat: add notification service (recipient resolution, templates, enqueue)"
```

---

## Task 3: Wire notifications into every workflow transition

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js` (call `notifyStage`/`notifyUser` from `startInstance`, `forwardInstance`, `sendBackInstance`, `rejectInstance`, `reassignInstance`)
- Test: `backend/tests/instances.notifications.test.js`

**Interfaces:**
- Consumes: `notifyStage`, `notifyUser` (Task 2).
- Produces: no new exports — existing transition functions now have the side effect of enqueueing the correct `notifications` rows.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instances.notifications.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'd1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'd1000000-0000-0000-0000-000000000002';
const STAGE1_USER = 'd1000000-0000-0000-0000-000000000003';
const STAGE2_USER = 'd1000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const stage1Token = signToken({ sub: STAGE1_USER, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('notifications enqueued by workflow transitions', () => {
  let instanceId;
  let documentTypeId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Instance Notifications Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'notif-inst-admin@example.com', password_hash: 'x', is_admin: true },
        { id: STAGE1_USER, tenant_id: TENANT_ID, email: 'notif-inst-stage1@example.com', password_hash: 'x' },
        { id: STAGE2_USER, tenant_id: TENANT_ID, email: 'notif-inst-stage2@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Notif Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Notif Approval' });
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
        name: 'Notif Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;
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

  it('enqueues an "assigned" notification to the stage 1 assignee on start', async () => {
    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({ documentTypeId });
    instanceId = started.body.id;

    const rows = await db('notifications').where({ tenant_id: TENANT_ID, workflow_instance_id: instanceId });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_email).toBe('notif-inst-stage1@example.com');
    expect(rows[0].subject).toContain('New task');
  });

  it('enqueues a "forwarded" notification to the new stage assignee on forward', async () => {
    await request(app)
      .post(`/instances/${instanceId}/forward`)
      .set('Authorization', `Bearer ${stage1Token}`)
      .send({});

    const rows = await db('notifications').where({
      tenant_id: TENANT_ID,
      workflow_instance_id: instanceId,
      recipient_email: 'notif-inst-stage2@example.com',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toContain('forwarded to you');
  });

  it('enqueues a "rejected" notification to the original submitter on reject', async () => {
    const stage2Token = signToken({ sub: STAGE2_USER, tenant_id: TENANT_ID, is_admin: false });
    await request(app)
      .post(`/instances/${instanceId}/reject`)
      .set('Authorization', `Bearer ${stage2Token}`)
      .send({ comment: 'Not acceptable' });

    const rows = await db('notifications').where({
      tenant_id: TENANT_ID,
      workflow_instance_id: instanceId,
      recipient_email: 'notif-inst-stage1@example.com',
    });
    const rejectionRow = rows.find((r) => r.subject.includes('rejected'));
    expect(rejectionRow).toBeDefined();
    expect(rejectionRow.body).toContain('Not acceptable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instances.notifications.test.js`
Expected: FAIL — no `notifications` rows are created yet.

- [ ] **Step 3: Wire notifications into `backend/src/services/workflowInstanceService.js`**

Add near the top, with the other requires:
```js
const { notifyStage, notifyUser } = require('./notificationService');
```

In `startInstance`, after the instance is inserted and before `return instance;`, add:
```js
  await notifyStage(tenantId, instance.id, 'assigned', firstStage, {
    documentTypeName: documentType.name,
    stageName: firstStage.name,
  });
```

In `forwardInstance`, after the `stage_actions` insert and before `return updated;`, add:
```js
  if (nextStage) {
    await notifyStage(tenantId, instanceId, 'forwarded', nextStage, {
      documentTypeName: documentType.name,
      stageName: nextStage.name,
    });
  } else {
    await notifyUser(tenantId, instanceId, 'completed', instance.created_by, {
      documentTypeName: documentType.name,
    });
  }
```

In `sendBackInstance`, first change the destructure at the top of the function from:
```js
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);
```
to:
```js
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);
```
Then, after the `stage_actions` insert and before `return updated;`, fetch the target stage and notify:
```js
  const targetStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: documentType.workflow_template_id, stage_order: targetStageOrder })
    .first();
  await notifyStage(tenantId, instanceId, 'sent_back', targetStage, {
    documentTypeName: documentType.name,
    stageName: targetStage.name,
  });
```

In `rejectInstance`, change the destructure from:
```js
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);
```
to:
```js
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);
```
Then, after the `stage_actions` insert and before `return updated;`, add:
```js
  await notifyUser(tenantId, instanceId, 'rejected', instance.created_by, {
    documentTypeName: documentType.name,
    comment,
  });
```

In `reassignInstance`, change the destructure from:
```js
  const { instance } = await getInstanceDetail(tenantId, instanceId);
```
to:
```js
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);
```
Then, after the `stage_actions` insert and before `return updated;`, add:
```js
  await notifyUser(tenantId, instanceId, 'reassigned', targetUserId, {
    documentTypeName: documentType.name,
    stageName: stage.name,
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/instances.notifications.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Run the full Phase 0-2 instance test suites to confirm nothing broke**

Run: `npx jest tests/instances`
Expected: all instance test suites still pass (the new notification inserts are additive side effects; none of those tests assert on `notifications` being empty).

- [ ] **Step 6: Commit**

```bash
git add src/services/workflowInstanceService.js tests/instances.notifications.test.js
git commit -m "feat: enqueue notifications from every workflow transition"
```

---

## Task 4: Background worker — poll, send, retry with cap

**Files:**
- Create: `backend/src/workers/notificationWorker.js`
- Test: `backend/tests/notificationWorker.test.js`

**Interfaces:**
- Consumes: `transporter`, `MAIL_FROM` (Task 1).
- Produces: `processPendingNotifications(sendMail?) -> Promise<number>` (processes one batch, returns count processed; `sendMail` is injectable for tests), `startNotificationWorker(intervalMs?) -> stopFn` (returns a function that stops the polling interval). `server.js` (Task 5) calls `startNotificationWorker`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/notificationWorker.test.js
const db = require('../src/config/db');
const { processPendingNotifications, MAX_ATTEMPTS } = require('../src/workers/notificationWorker');

const TENANT_ID = 'd2000000-0000-0000-0000-000000000001';

async function insertPendingNotification(overrides = {}) {
  const [row] = await db('notifications')
    .insert({
      tenant_id: TENANT_ID,
      recipient_email: 'worker-test@example.com',
      subject: 'Test subject',
      body: 'Test body',
      status: 'pending',
      ...overrides,
    })
    .returning('*');
  return row;
}

describe('processPendingNotifications', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Worker Test Tenant' }).onConflict('id').ignore();
  });

  afterEach(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
  });

  afterAll(async () => {
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('marks a notification sent when delivery succeeds', async () => {
    const notification = await insertPendingNotification();
    const sendMail = jest.fn().mockResolvedValue({});

    await processPendingNotifications(sendMail);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'worker-test@example.com', subject: 'Test subject' }),
    );
    const updated = await db('notifications').where({ id: notification.id }).first();
    expect(updated.status).toBe('sent');
  });

  it('retries on a simulated SMTP outage instead of dropping the notification', async () => {
    const notification = await insertPendingNotification();
    const failingSendMail = jest.fn().mockRejectedValue(new Error('ECONNREFUSED: simulated SMTP outage'));

    await processPendingNotifications(failingSendMail);

    const afterFirstFailure = await db('notifications').where({ id: notification.id }).first();
    expect(afterFirstFailure.status).toBe('pending');
    expect(afterFirstFailure.attempts).toBe(1);
    expect(afterFirstFailure.last_error).toContain('simulated SMTP outage');

    const recoveringSendMail = jest.fn().mockResolvedValue({});
    await processPendingNotifications(recoveringSendMail);

    const afterRecovery = await db('notifications').where({ id: notification.id }).first();
    expect(afterRecovery.status).toBe('sent');
  });

  it('marks a notification failed after MAX_ATTEMPTS consecutive failures', async () => {
    const notification = await insertPendingNotification();
    const failingSendMail = jest.fn().mockRejectedValue(new Error('persistent outage'));

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await processPendingNotifications(failingSendMail);
    }

    const finalRow = await db('notifications').where({ id: notification.id }).first();
    expect(finalRow.status).toBe('failed');
    expect(finalRow.attempts).toBe(MAX_ATTEMPTS);

    failingSendMail.mockClear();
    await processPendingNotifications(failingSendMail);
    expect(failingSendMail).not.toHaveBeenCalled();
  });

  it('ignores notifications that are not pending', async () => {
    await insertPendingNotification({ status: 'sent' });
    const sendMail = jest.fn().mockResolvedValue({});

    await processPendingNotifications(sendMail);

    expect(sendMail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/notificationWorker.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `backend/src/workers/notificationWorker.js`**

```js
const db = require('../config/db');
const { transporter, MAIL_FROM } = require('../config/mailer');

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

async function processPendingNotifications(sendMail = transporter.sendMail.bind(transporter)) {
  const pending = await db('notifications').where({ status: 'pending' }).orderBy('created_at', 'asc').limit(BATCH_SIZE);

  for (const notification of pending) {
    try {
      await sendMail({
        from: MAIL_FROM,
        to: notification.recipient_email,
        subject: notification.subject,
        text: notification.body,
      });
      await db('notifications').where({ id: notification.id }).update({ status: 'sent' });
    } catch (err) {
      const attempts = notification.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      await db('notifications').where({ id: notification.id }).update({
        attempts,
        status,
        last_error: err.message,
      });
    }
  }

  return pending.length;
}

function startNotificationWorker(intervalMs = 10000) {
  const timer = setInterval(() => {
    processPendingNotifications().catch((err) => {
      console.error('Notification worker error:', err);
    });
  }, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { processPendingNotifications, startNotificationWorker, MAX_ATTEMPTS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/notificationWorker.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/workers/notificationWorker.js tests/notificationWorker.test.js
git commit -m "feat: add notification worker with poll-and-send retry"
```

---

## Task 5: Start the worker on boot, and end-to-end exit-criteria verification

**Files:**
- Modify: `backend/src/server.js` (start the worker after the HTTP server listens)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: `startNotificationWorker` (Task 4).
- Produces: nothing new — this is the phase's final integration task.

- [ ] **Step 1: Update `backend/src/server.js`**

```js
const app = require('./app');
const { validateEnv } = require('./config/env');
const { startNotificationWorker } = require('./workers/notificationWorker');

const config = validateEnv();

app.listen(config.port, () => {
  console.log(`Workflow engine API listening on port ${config.port}`);
});

startNotificationWorker();
```

- [ ] **Step 2: Run the full automated test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all suites pass (Phases 0-2's 66 tests + this phase's new tests).

- [ ] **Step 3: Verify against the running stack**

With `docker compose up -d postgres`, `npm run migrate`, `npm run seed`, and `npm run dev` running (SMTP left unconfigured/unreachable in `.env`, simulating an outage), repeat Phase 2's exit-criteria curl walkthrough (start, upload, forward, send-back, forward, forward, reject, resubmit) and then inspect the queue directly:

```bash
docker compose exec postgres psql -U workflow -d workflow_engine -c "SELECT event_type, recipient_email, status, attempts, last_error FROM (SELECT subject AS event_type, recipient_email, status, attempts, last_error FROM notifications ORDER BY created_at) t;"
```

Expected: one `notifications` row per transition (assigned at start, forwarded at each forward, sent_back at the send-back, rejected at the reject), all initially `status = 'pending'`. Because there is no real SMTP server reachable, the worker's periodic poll (every 10s by default) will attempt delivery and fail — after a short wait, re-run the query and confirm `attempts > 0` and `last_error` is populated, while `status` stays `'pending'` (not silently dropped) until `MAX_ATTEMPTS` is reached.

- [ ] **Step 4: Update `PROGRESS.md` with the Phase 3 completion summary and commit**

```bash
git add PROGRESS.md
git commit -m "docs: update progress log for Phase 3 completion"
```

## Phase 3 Exit Criteria (verify all before moving to Phase 4)

- [ ] Every transition in Phase 2's test walkthrough (assigned, forwarded, sent back, rejected, completed, reassigned) produces the correct `notifications` row(s) to the correct recipients.
- [ ] No notification is ever sent inline during a request — only the background worker calls `sendMail`.
- [ ] A simulated SMTP failure increments `attempts`, records `last_error`, and leaves `status = 'pending'` for retry rather than dropping the row.
- [ ] After `MAX_ATTEMPTS` consecutive failures, `status` becomes `'failed'` and the worker stops retrying that row.
- [ ] Full test suite passes.
