# Group-Assignable Predefined Workflows — Design Spec

Status: Approved for implementation
Scope: sub-project 2 of 4 in the larger "groups, ad-hoc workflows, comments" initiative
(see `docs/superpowers/specs/2026-09-04-groups-and-visibility-design.md` §7 for the
roadmap). This spec extends predefined workflow stage assignment — currently a single
named user or a role — to also allow "assign to a group," with claim semantics that
exactly match the existing role-assignment behavior.

## 1. Purpose

Sub-project 1 added groups (many-to-many user membership) and visibility-scoped
pickers, but nothing in the workflow engine can actually assign a stage to a group yet
— `workflow_stages.assignee_type` is still `'user' | 'role'` only. This spec adds
`'group'` as a third assignee type, so an admin building a predefined workflow can
assign a stage to, say, "IT Group" instead of naming one person or requiring a
tenant-wide role.

## 2. Data model

- `workflow_stages.assignee_type` — a native Postgres enum, currently `'user' |
  'role'`. Add `'group'`: `ALTER TYPE assignee_type ADD VALUE 'group'`. This migration
  must not reference the new enum value anywhere else in the same migration file
  (Postgres forbids using a newly-added enum value in the same transaction that added
  it) — the column addition below is a separate, unrelated DDL statement and is safe
  to run in the same migration.
- `workflow_stages.assignee_group_id` — new nullable `uuid` column, composite FK
  `(tenant_id, assignee_group_id)` → `groups(tenant_id, id)`, mirroring the existing
  `assignee_role_id` FK to `roles(tenant_id, id)` exactly (no `ON DELETE` action needed
  here — see §5, deletion is blocked at the application layer before it would ever
  cascade).

No other schema changes. `workflow_templates`, `document_types`, `workflow_instances`
are untouched.

## 3. Claim semantics

A group-assigned stage behaves exactly like a role-assigned stage:

- The stage starts unclaimed (`workflow_instances.claimed_by IS NULL`).
- Any member of the assigned group may `POST /instances/:id/claim`. `claimInstance`
  gains a group-membership check (`user_groups` lookup) alongside its existing
  role-membership check, and rejects (403) a claim attempt from a non-member exactly as
  it does today for non-role-holders.
- Once claimed, `canAct` (unchanged — it already only checks `claimed_by === userId`
  once a claim exists) governs who may act, same as every other stage type.
- Only one member may hold the claim at a time — this is the whole reason claim exists
  for group/role stages, preventing two members acting concurrently.

## 4. "My tasks" eligibility

`dashboardService.listMyTasks` currently computes `eligibleToClaimRole` (stage is
role-assigned, unclaimed, caller holds that role) to decide whether an unclaimed
role-assigned instance shows under "Assigned to Me". Add a parallel
`eligibleToClaimGroup` (stage is group-assigned, unclaimed, caller is a member of that
group) so unclaimed group-assigned instances are visible to every group member the same
way.

## 5. Group deletion guard

`groupService.deleteGroup` currently deletes unconditionally. It must now check whether
any `workflow_stages` row in this tenant has `assignee_group_id` equal to the group
being deleted, and if so throw `AppError(409, 'Group is assigned to one or more
workflow stages and cannot be deleted')`. The admin must repoint or remove those stage
assignments first. This matches the note already left in sub-project 1's spec (§4,
`DELETE /admin/groups/:id`).

## 6. Notifications

`notificationService.resolveStageRecipientEmails` currently branches on
`assignee_type` (`'user'` → that user's email; else → every role-holder's email). Add a
group branch: every member of `assignee_group_id` gets emailed, mirroring the
role-holder query exactly (join `user_groups` → `users`, tenant-scoped).

## 7. Admin API

`POST /admin/workflow-templates/:id/stages` (existing endpoint,
`workflowTemplateService.addWorkflowStage`) already accepts `assigneeType` +
`assigneeUserId`/`assigneeRoleId` in the request body. Extend validation to also accept
`assigneeType: 'group'` + `assigneeGroupId` — validate `assigneeGroupId` is a UUID
belonging to this tenant's `groups` table, same shape as the existing
`assigneeRoleId` check.

No new endpoints. `getWorkflowTemplate`'s stages query
(`backend/src/services/workflowTemplateService.js`) has no explicit `.select(...)` —
it's an implicit `select *` — so `assignee_group_id` flows through automatically once
the column exists; no query change needed there. `addWorkflowStage`'s validation
(`ALLOWED_ASSIGNEE_TYPES = ['user', 'role']` plus an `if (assigneeType === 'user') {
...} else { ...role validation... }` block) needs to become a three-way branch: add
`'group'` to `ALLOWED_ASSIGNEE_TYPES`, and a third branch that validates
`assigneeGroupId` as a UUID belonging to this tenant's `groups` table (same shape as
the existing role-validation branch), setting `assignee_group_id` on insert (and
leaving `assignee_user_id`/`assignee_role_id` null, matching the existing pattern
where only the relevant FK column is populated).

## 8. Frontend

`WorkflowTemplateDetailPage.tsx`'s "Add stage" form currently has a two-way radio
(`assign to user` / `assign to role`). Add a third option, "Assign to group", backed by
the existing admin `listGroups` API (`frontend/src/api/groups.ts`, already built in
sub-project 1, already unrestricted for admins — no new visibility-scoped picker is
needed here since only admins build predefined workflows). The stage list display
(`workflowTemplate.stages.map(...)`) already renders
`stage.assignee_type === 'user' ? 'assigned user' : 'assigned role'` — extend this to a
three-way switch including `'group'`.

## 9. Out of scope

Ad-hoc (user-built) workflows, comments (sub-projects 3 and 4 — unchanged from
sub-project 1's roadmap). Reassignment (`POST /instances/:id/reassign`, admin-only,
already targets a specific user regardless of the current stage's assignee type) is
unaffected and needs no change. Bulk-repointing stages away from a group being deleted
(§5 just blocks the delete; it does not offer an admin UI to reassign-and-delete in one
step).

## 10. Testing

Backend integration tests: migration adds the enum value and column cleanly against
the existing dev/test DB (no data migration needed — no existing rows use `'group'`);
`claimInstance` accepts a claim from a group member and rejects a non-member for a
group-assigned stage; `listMyTasks` surfaces an unclaimed group-assigned instance to
every group member; `resolveStageRecipientEmails` emails every group member for a
group-assigned stage's notifications; `deleteGroup` returns 409 when the group is
still referenced by a stage, and succeeds once the reference is removed;
`addWorkflowStage` accepts `assigneeType: 'group'` and rejects a `assigneeGroupId` from
another tenant. Frontend verified manually in-browser, consistent with sub-project 1.
