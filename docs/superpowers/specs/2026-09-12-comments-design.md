# Workflow Instance Comments — Design Spec

Status: Approved for implementation
Scope: sub-project 4 of 4 in the "groups, ad-hoc workflows, comments" initiative
(see `docs/superpowers/specs/2026-09-04-groups-and-visibility-design.md` §7 for the
roadmap). This spec adds a flat, unthreaded comment list on a workflow instance,
independent of the existing per-action comment (`stage_actions.comment`, attached to a
forward/reject/send-back and shown in the audit log).

## 1. Purpose

Today the only way to leave a note on a workflow instance is the single optional comment
attached to a forward/reject/send-back action — a comment tied to one specific state
transition, authored only by whoever is acting at that moment. There's no way to have an
open discussion on an instance: ask a question mid-review, leave context for the next
stage, or note something without also performing an action. This spec adds a standalone
comment thread, visible and postable by everyone who has a stake in that instance.

## 2. Data model

New `comments` table:

- `id` — uuid pk, `gen_random_uuid()`.
- `tenant_id` — uuid, FK → `tenants(id)`, `ON DELETE CASCADE`.
- `workflow_instance_id` — uuid, not null, composite FK `(tenant_id,
  workflow_instance_id)` → `workflow_instances(tenant_id, id)`, `ON DELETE CASCADE`
  (mirrors `instance_versions`/`stage_actions` exactly).
- `author_id` — uuid, not null, composite FK `(tenant_id, author_id)` →
  `users(tenant_id, id)`.
- `body` — text, not null.
- `created_at` — timestamp, not null, `now()`.

No `updated_at`, no soft-delete flag — comments are permanent once posted, matching your
decision and the existing `stage_actions.comment` precedent (also never editable).
Indexes: `tenant_id`, `workflow_instance_id` (mirrors the sibling tables).

## 3. Authorization — "involved in this instance"

A new helper, `isInvolvedInInstance(tenantId, instance, stage, userId, isAdmin)` in
`workflowInstanceService.js` (or a new small module if that file is getting large —
implementer's call), used identically to gate both reading and posting comments. Returns
`true` when any of:

1. `isAdmin` is true.
2. `instance.created_by === userId`.
3. `userId` appears as `actor_id` in any `stage_actions` row for this instance (a
   one-query existence check: `db('stage_actions').where({tenant_id,
   workflow_instance_id, actor_id: userId}).first()`).
4. `canAct(stage, instance, userId)` is true (the existing helper in
   `utils/workflowAuthorization.js` — covers the current claimant, or the stage's
   directly-assigned user).
5. The current stage is unclaimed and role- or group-assigned, and `userId` holds that
   role / is a member of that group — mirroring `dashboardService.listMyTasks`'s
   `eligibleToClaimRole`/`eligibleToClaimGroup` checks exactly (someone who could claim
   and act on it right now counts as involved, even before they've claimed it).

This is deliberately a *narrower* scope than the existing `GET /instances/:id` (which has
no authorization check today, by design predating this spec — out of scope to change
here). Comments get their own, stricter gate; the base instance-detail endpoint is
unchanged.

Because both `GET` and `POST` use the exact same check, a client that successfully lists
comments already knows it's allowed to post — no separate "can I comment" flag is needed
in the API response.

## 4. API

Both new routes live in `backend/src/routes/instances.js`, under the existing
`/instances` router (so `router.use(authenticate)` already applies):

- `GET /instances/:id/comments` — returns comments for the instance ordered by
  `created_at asc`, each `{ id, author_id, author_name, body, created_at }` (`author_name`
  joined from `users.full_name` falling back to `email`, so the frontend doesn't need a
  separate user lookup). 403 (via `AppError`) if the caller fails `isInvolvedInInstance`.
- `POST /instances/:id/comments` — body `{ body: string }`, `assertRequiredString`
  validated. 403 under the same check. On success, inserts the row and returns it in the
  same shape as the list, then fires notifications (§5) and responds 201.

Service functions in `workflowInstanceService.js`: `listComments(tenantId, userId,
isAdmin, instanceId)` and `addComment(tenantId, userId, isAdmin, instanceId, body)`. Both
start by calling the existing `getInstanceDetail(tenantId, instanceId)` to get
`instance`/`stage`, then run the involvement check before touching the `comments` table —
reusing the exact same instance/stage resolution every other instance-scoped function in
this file already uses (including the ad-hoc-vs-predefined `workflow_template_id`
resolution from the previous sub-project, at no extra cost).

## 5. Notifications

New template in `notificationService.js`'s `TEMPLATES`:

```js
commented: ({ documentTypeName, authorName }) => ({
  subject: `New comment: ${documentTypeName}`,
  body: `${authorName} commented on "${documentTypeName}".`,
}),
```

(No comment excerpt in the email body — keeps the template simple and avoids leaking
potentially long/sensitive comment text into an email subject/preview; the recipient
clicks through to read it.)

`addComment` resolves the recipient set *by role, not by re-running
`isInvolvedInInstance` per candidate user* — email everyone who is concretely involved:
the creator, every distinct `stage_actions.actor_id`, and the current stage's resolved
assignee(s) via the existing `resolveStageRecipientEmails(tenantId, stage)` (already
handles user/role/group correctly). Collect into a `Set` of emails, remove the comment
author's own email, and enqueue one notification per remaining address via the existing
`enqueueNotification`. Admins are **not** auto-notified merely for being admins — only if
they also happen to be the creator or an actor. This keeps "everyone involved" meaning
actual participants, not everyone who merely has access.

## 6. Frontend

- New `frontend/src/api/comments.ts`:
  ```ts
  export interface InstanceComment {
    id: string;
    author_id: string;
    author_name: string;
    body: string;
    created_at: string;
  }
  export function listComments(instanceId: string): Promise<InstanceComment[]>;
  export function addComment(instanceId: string, body: string): Promise<InstanceComment>;
  ```
- `InstanceDetailPage.tsx` gains a "Comments" section in the left column, below the
  existing "Audit Log" block: the list (author name, relative/absolute timestamp, body),
  then a `<textarea>` + "Post" button. The comment query uses React Query; a 403 response
  means "not involved" — in that case the whole Comments section renders nothing (no
  error banner, since not being involved is an expected, non-error state for a tenant
  user who can otherwise view the instance). A successful list load always means posting
  is allowed too (§3), so the input is simply always shown alongside a non-empty/403'd
  list result.

## 7. Out of scope

- Editing or deleting a posted comment.
- Threading/replies, @mentions, reactions.
- Changing the existing `GET /instances/:id` (and its current lack of authorization) —
  unrelated to this spec, pre-existing behavior.
- Any change to the existing per-action `stage_actions.comment` field or its audit-log
  display — the two comment mechanisms remain independent and both visible.
- Admin visibility into comments across instances (e.g. a global comments feed) — only
  the per-instance list.

## 8. Testing

Backend integration tests (new `backend/tests/instances.comments.test.js`): posting as
the creator, as a past actor (from a prior forward), as the current stage's directly
assigned user, and as an eligible-but-unclaimed group member, all succeed (201) and the
comment appears in a subsequent `GET`; posting/reading as a tenant user with none of
those relationships to the instance returns 403 for both endpoints; posting as an admin
who has no other relationship to the instance succeeds; the notification recipients for
a posted comment include the creator and current assignee but exclude the comment's own
author, verified against the `notifications` table the same way existing stage-transition
notification tests already do.
