# Groups & Visibility — Design Spec

Status: Approved for implementation
Scope: sub-project 1 of 4 in the larger "groups, ad-hoc workflows, comments" initiative
(see §7 for the full roadmap). This spec covers groups, group membership, visibility-scoped
user/group pickers, and human-readable ticket numbers.

## 1. Purpose

The current system assigns workflow stages to a single named user or a role, and has no
concept of "several people as one assignable unit" (e.g. an IT group or a Finance group).
It also has no restriction on which users a given user can see/pick from, and no
human-friendly identifier for a workflow instance (only its UUID).

This spec adds:
- **Groups**: a tenant-scoped entity representing a team/department (e.g. "IT Group"),
  with many-to-many user membership. A user's group membership doubles as their
  department — there is no separate department concept.
- **Visibility-scoped pickers**: any non-admin user, when picking people/groups (used by
  later sub-projects — ad-hoc workflow building, reassignment, etc.), only sees users who
  share at least one group with them, plus the groups they themselves belong to. Admins
  see everyone/every group.
- **Ticket numbers**: a short, human-readable, tenant-scoped sequential identifier
  (`WF-000123`) displayed alongside the existing UUID, which remains the real primary key
  and URL parameter.

## 2. Data model

- `groups` — `id` (uuid pk), `tenant_id` (fk), `name`, timestamps. Unique
  `(tenant_id, name)`. Mirrors `roles` exactly, including the `(tenant_id, id)` unique
  pair that lets child tables enforce composite tenant-safe FKs.
- `user_groups` — `id` (uuid pk), `tenant_id`, `user_id`, `group_id`, `created_at`.
  Mirrors `user_roles` exactly: unique `(user_id, group_id)`, composite FKs
  `(tenant_id, user_id)` → `users` and `(tenant_id, group_id)` → `groups`, both
  `ON DELETE CASCADE`.
- `tenant_ticket_counters` — `tenant_id` (pk, fk to `tenants`), `next_number` (integer,
  default 1). One row per tenant, created alongside the tenant. Incremented
  transactionally (`SELECT ... FOR UPDATE`) when a workflow instance is created, and the
  pre-increment value is stored as that instance's ticket number.
- `workflow_instances` gains `ticket_number` (integer, not null). Unique
  `(tenant_id, ticket_number)`. Displayed as `WF-<ticket_number padded to 6 digits>`;
  formatting is presentation-only (API returns the raw integer plus tenant is
  implicit from auth, UI does the `WF-` prefix/padding).

## 3. Visibility rule

For any non-admin user U:
- **Visible users** = U themself, plus every user who shares at least one group with U.
- **Visible groups** = every group U belongs to.

Admins bypass this rule entirely — admin-facing pickers (e.g. group membership
management, admin reassignment) always see the full tenant user/group list.

This is enforced server-side (the endpoint itself filters), not just hidden in the UI,
since a restricted user's client could otherwise call the unrestricted endpoint directly.

## 4. API

All routes tenant-scoped via the JWT, same conventions as the existing API
(`{ error: string }` error shape, 201/400/401/403/404, UUID-format validation on path
params).

- `GET /admin/groups` — list all groups (admin only).
- `POST /admin/groups` — create `{ name }` (admin only).
- `GET /admin/groups/:id` — group detail with member list (admin only).
- `PUT /admin/groups/:id` — rename (admin only).
- `DELETE /admin/groups/:id` — delete, unconditional in this sub-project (no other table
  references a group yet). Once sub-project 2 adds group-assignable stages, that spec
  will add a 409 guard here for groups still referenced by a stage assignment.
- `POST /admin/groups/:id/members` — add `{ user_id }` (admin only).
- `DELETE /admin/groups/:id/members/:user_id` — remove (admin only).
- `GET /users/visible` — the calling user's visibility-scoped user list (any
  authenticated user; admins get the full tenant list).
- `GET /groups/visible` — the calling user's visibility-scoped group list (same rule).

`ticket_number` requires no new endpoint: it's added to the existing instance
create/list/detail responses (`POST /instances`, `GET /instances/my-tasks`,
`GET /instances/:id`, `GET /admin/instances`).

## 5. Frontend

- **`/admin/groups`** — list (name, member count), create form, rename inline, delete
  (with confirmation).
- **`/admin/groups/:id`** — member list with remove buttons, an "Add member" user picker
  (unrestricted, since this screen is admin-only).
- **Ticket number display** — added next to the existing UUID-derived links on
  `/my-tasks` cards, `/instances/:id` header, and the `/admin/instances` table. Routing
  continues to use the UUID; the ticket number is label-only in this sub-project (no
  "look up by ticket number" search yet — out of scope, see §6).

## 6. Out of scope (this sub-project)

- Assigning a workflow stage to a group (sub-project 2).
- Ad-hoc workflow building using the visible-users/groups pickers (sub-project 3) — this
  spec only builds the picker endpoints themselves.
- Comments (sub-project 4).
- Searching/looking up an instance by its ticket number (only display, for now).
- Nested groups or a user having a "primary" group — membership is flat and unordered.

## 7. Roadmap (for context, not part of this spec's implementation)

1. **Groups & visibility** (this spec).
2. Group-assignable predefined workflows — extend stage assignment (currently user or
   role) to also allow "assign to group," with claim semantics matching role stages.
3. Ad-hoc workflow mode — `document_types.workflow_mode` (`predefined` | `adhoc`); when
   `adhoc`, the starting user builds the full ordered stage list (person or group, from
   their visible pool) upfront at instance-creation time, instead of running a
   preconfigured `workflow_template`.
4. Comments — a flat, unthreaded comment list per workflow instance, visible to everyone
   involved in that instance.

## 8. Testing

Backend integration tests (matching the existing suite's style): group CRUD, membership
add/remove, tenant isolation (a group/user from tenant A never appears in tenant B's
queries), and the visibility rule itself — specifically that a user with no shared group
sees only themself, and that admin pickers are unrestricted. Ticket number: uniqueness
and monotonic increase under concurrent instance creation (the `FOR UPDATE` counter).
Frontend verified manually in-browser, consistent with prior phases (no frontend
automated tests in this project).
