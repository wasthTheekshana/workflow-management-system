# Ad-Hoc Workflow Mode — Design Spec

Status: Approved for implementation
Scope: sub-project 3 of 4 in the larger "groups, ad-hoc workflows, comments" initiative
(see `docs/superpowers/specs/2026-09-04-groups-and-visibility-design.md` §7 for the
roadmap). This spec adds a second way to run a document through a workflow: instead of
an admin-predefined `workflow_template`, the user starting the instance builds the
ordered stage list themselves, from their visibility-scoped pool of users and groups.

## 1. Purpose

Today every `document_types` row points at exactly one `workflow_templates` row, fixed
by an admin ahead of time (`document_types.workflow_template_id`, not null). There is no
way to start a document through a one-off approval chain that a regular user assembles
on the spot — e.g. "have Alice review it, then the Finance group sign off." This spec
adds that as a per-document-type mode, chosen by the admin when the document type is
created.

## 2. Data model

- `document_types.workflow_mode` — new native enum column, `'predefined' | 'adhoc'`,
  not null, default `'predefined'`. Existing rows backfill to `'predefined'` (their
  current, only behavior).
- `document_types.workflow_template_id` — becomes nullable. Not null when
  `workflow_mode = 'predefined'`; always null when `workflow_mode = 'adhoc'` (an
  ad-hoc document type has no fixed template — there is nothing to point at until an
  instance is actually started). Enforced at the application layer (`documentTypeService`
  validation), not a DB constraint — Postgres check constraints spanning two nullable
  columns add friction disproportionate to the benefit here, and every write path already
  goes through the service layer.
- `workflow_instances.workflow_template_id` — new not-null `uuid` column, composite FK
  `(tenant_id, workflow_template_id)` → `workflow_templates(tenant_id, id)`. This is the
  key structural change: every stage-progression function currently resolves "what
  template governs this instance's stages" via `documentType.workflow_template_id`.
  That's fine for `'predefined'` but has no answer for `'adhoc'`. Moving the pointer onto
  the instance itself means each instance carries its own answer regardless of mode:
  - Predefined: copied from `documentType.workflow_template_id` at start time (same
    template shared by every instance of that document type, as today).
  - Ad-hoc: points at a new `workflow_templates` row created just for this instance (see
    §3), never reused by any other instance.

  No other schema changes. `workflow_stages` is unchanged — the existing `assignee_type
  'user' | 'role' | 'group'` set (from sub-project 2) is reused as-is, restricted at the
  application layer to `'user' | 'group'` for ad-hoc stages (see §4 — roles are an
  admin/predefined-workflow concept and are not exposed to the ad-hoc builder).

## 3. Starting an ad-hoc instance (backend)

`workflowInstanceService.startInstance(tenantId, userId, documentTypeId, stages?)` gains
an optional fourth argument, required exactly when `documentType.workflow_mode ===
'adhoc'` (rejected as 400 if provided for a `'predefined'` type, and required — 400 if
missing or empty — for an `'adhoc'` type).

Each entry in `stages`: `{ name, assigneeType: 'user' | 'group', assigneeId }`. Server
validation, in order:
1. `stages` is a non-empty array.
2. Each `name` is a non-empty string.
3. Each `assigneeType` is `'user'` or `'group'`.
4. Each `assigneeId` is a UUID belonging to this tenant (`users` or `groups` table
   matching `assigneeType`) — reuses the same `assertBelongsToTenant`-style check already
   used elsewhere in this service.

`allowed_actions` is not accepted from the client for ad-hoc stages — every stage gets
the existing default, `['forward', 'send_back', 'reject']`, matching
`workflowTemplateService`'s own fallback when a predefined stage omits it. This keeps the
ad-hoc builder to "who does each step," not a full replica of the admin template editor.

In one transaction:
1. Insert a new `workflow_templates` row. Name: `` `${documentType.name} (ad-hoc, started
   ${new Date().toISOString()})` `` — human-readable for anyone who ends up looking at
   `workflow_templates` directly (e.g. via `GET /admin/workflow-templates`); never shown
   to end users, who only ever see the instance itself.
2. Insert one `workflow_stages` row per entry in `stages`, `stage_order` = array index +
   1, `assignee_type`/`assignee_user_id`/`assignee_group_id` set per entry (mirroring
   `workflowTemplateService.addWorkflowStage`'s existing insert shape), all against the
   new template's id.
3. Insert the `workflow_instances` row exactly as today, plus
   `workflow_template_id: <the new template's id>`.

For `'predefined'`, step 1–2 are skipped; step 3 sets `workflow_template_id:
documentType.workflow_template_id`, and the rest of `startInstance` (latest template
file version lookup, first-stage lookup, initial notification) is unchanged — it already
queries `workflow_stages` by `workflow_template_id`, which now comes from the instance
computation above rather than being re-derived from the document type at every call site.

**Every other stage-progression function switches its source of truth from
`documentType.workflow_template_id` to `instance.workflow_template_id`:**
`getInstanceDetail`, `forwardInstance`, `sendBackInstance` (their `workflow_stages`
queries currently join on `documentType.workflow_template_id`). `claimInstance`,
`rejectInstance`, `addInstanceVersion`, `addInstanceContentVersion` don't query
`workflow_stages` directly — they call `getInstanceDetail` and use the `stage` it
returns — so they need no change at all. This is why the one-off-template approach costs
so little: nothing downstream needs to know or care whether a stage came from a shared
predefined template or a private ad-hoc one.

`resubmitInstance` copies `workflow_template_id` from the original instance (alongside
the existing `document_type_id`/`template_file_version_id` copy), so a rejected ad-hoc
submission resubmits through the same one-off stage list rather than losing it.

## 4. Admin UI — `DocumentTypesPage.tsx`

The create form gains a radio: "Predefined workflow" (default; shows the existing
workflow-template `<select>`, required) vs. "Users define the workflow when they start
it" (hides the `<select>`, sends `workflowMode: 'adhoc'`, omits `workflowTemplateId`).
The document type list shows the mode next to each row's name (e.g. "— ad-hoc") so an
admin can tell at a glance without opening each one. Editing an existing document type's
mode after creation is out of scope (§6) — mode is fixed at creation, matching how
`workflow_template_id` is already immutable post-creation today.

## 5. End-user UI — `NewInstancePage.tsx`

- `GET /instances/startable-document-types` (backing `listStartableDocumentTypes`)
  starts returning `workflow_mode` per document type, so the frontend can branch.
- Predefined: unchanged — pick a type, submit.
- Ad-hoc: once such a type is selected, a stage builder appears below the picker:
  - Rows of `{ name text input, assignee-type radio (Person / Group), assignee <select>
    }`. The assignee `<select>` is populated from `GET /users/visible` or `GET
    /groups/visible` (already built in sub-project 1, unused by any frontend code until
    now) depending on the row's assignee-type — so a non-admin user seeing this builder
    only ever picks from people/groups they actually share visibility with, never the
    full tenant roster.
  - "Add stage" / per-row "Remove" (minimum one row, first row not removable below one).
  - Submit sends `documentTypeId` + `stages: [{ name, assigneeType, assigneeId }]` in
    stage order (array order = `stage_order`).
- New frontend API functions: `listVisibleUsers` / `listVisibleGroups` in
  `frontend/src/api/users.ts` / `groups.ts` (`GET /users/visible` / `GET /groups/visible`
  — distinct from the existing admin-only `listUsers`/`listGroups`, which stay
  unrestricted for the admin screens that already use them).

## 6. Out of scope

- Editing an ad-hoc document type's mode after creation, or editing a running instance's
  stage list after it's started (the one-off template is fixed once created, same as a
  predefined template is never edited mid-flight for instances already using it).
- Reordering/removing a stage from a running ad-hoc instance.
- Role as an ad-hoc assignee type (per your decision — ad-hoc sticks to people/groups
  from the starting user's visible pool; roles remain a predefined-workflow-only
  concept).
- Per-stage allowed-actions configuration in the ad-hoc builder (sensible defaults only,
  per your decision).
- Comments (sub-project 4, unchanged from the existing roadmap).
- Any change to `AdminInstancesPage` beyond what already works: it already displays
  `currentStage.name`/status generically and doesn't care whether the stage's parent
  template is shared or one-off, so it needs no code change — noted here only so it's
  clear this was considered, not missed.

## 7. Testing

Backend integration tests: starting an ad-hoc instance with no `stages` → 400; with an
`assigneeId` from another tenant → 400; happy path creates a `workflow_templates` +
`workflow_stages` rows and an instance whose `workflow_template_id` points at them;
`forwardInstance`/`sendBackInstance`/`claimInstance`/`rejectInstance` all function
identically against an ad-hoc instance as they already do against a predefined one
(reuse the existing predefined-flow test shapes against an ad-hoc-created instance);
`resubmitInstance` on a rejected ad-hoc instance preserves the same
`workflow_template_id`; existing predefined-flow tests continue passing unchanged
(regression check that copying `workflow_template_id` onto the instance didn't change
any observable behavior for the existing mode). Frontend: `tsc -b` clean; manual
walkthrough — create an ad-hoc document type, start an instance assigning stage 1 to a
person and stage 2 to a group, forward through both, confirm the assigned group member
can claim and act.
