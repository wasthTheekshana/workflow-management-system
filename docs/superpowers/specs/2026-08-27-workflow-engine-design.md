# Configurable Document Workflow Engine — Design Spec

Status: Approved for implementation
Source: `Workflow_Engine_Implementation_Plan.docx` (DOK Solutions Lanka, Phase 1 Implementation Plan)
Scope of this spec: backend API only. Frontend (React) is a separate, later project.

## 1. Purpose

A multi-tenant, configurable document approval workflow engine. A tenant defines document
types (e.g. SRS, HR letter), each linked to a master template and a stage sequence. Users
move a document instance through stages (forward / send-back / hard-reject), with every
edit versioned and every transition audited and emailed.

Standalone, sellable product from day one; later integrates into the DocuMind DMS platform.

## 2. Scope decisions (delta from the source plan)

The source plan is treated as authoritative except for these clarifications, agreed with
the user before implementation:

| Topic | Decision |
|---|---|
| Frontend | Out of scope for this build. All phase exit criteria are API-testable, matching the plan's own phrasing ("via API calls alone"). |
| Auth bootstrap | The plan lists `/auth/login` as "out of scope for Phase 1" but also says it "must be built before go-live" and the auth middleware assumes a token already exists. Resolution: build a minimal `POST /auth/login` (bcrypt password check against `users`, issues JWT) in Phase 0, plus a seed script for the first tenant/admin/user. No `/auth/register` and no password reset — those remain out of scope. |
| Build cadence | Phase 0 → 1 → 2 → 3 → 4 → 5, in the plan's order. Each phase is checked against its stated exit criteria and reported before moving on. |
| Local dev environment | Docker Compose (API + PostgreSQL), confirmed available on this machine. |

Everything else below is carried over from the source plan unchanged.

## 3. Core workflow

1. A user selects a predefined document type from the tenant's template library.
2. The system creates a workflow instance, snapshotting the current master template version
   as the starting file.
3. Stage 1's assignee downloads the file, edits it externally (Word), and re-uploads it as a
   new version.
4. They forward to Stage 2. Stage 2 can edit and forward, send back to Stage 1, or hard-reject.
5. This repeats for further configured stages.
6. Every transition (forward, send-back, reject, reassign, claim) emails the relevant people
   via a queued notification, never sent inline.

## 4. Data model

Tenant-scoped throughout — every table (other than `tenants` itself) carries `tenant_id`.

- `tenants` — root of multi-tenancy.
- `users`, `roles`, `user_roles` — per-tenant identity and role membership.
- `template_files`, `template_file_versions` — master template library, versioned (immutable).
- `document_types` — selectable types; links a template to a workflow template.
- `workflow_templates`, `workflow_stages` — configurable stage sequence; each stage is
  user- or role-assigned, with allowed actions.
- `workflow_instances` — one running document; current stage, status, claim state.
- `instance_versions` — every save, versioned, nothing overwritten.
- `stage_actions` — full audit trail: forward, send back, reject, reassign, claim.
- `notifications` — outbound email queue with delivery status and retry.

## 5. Key design decisions

- **Document editing**: download/edit-externally/re-upload, not an in-browser editor. Every
  re-upload is a new `instance_versions` row.
- **Assignment flexibility**: a stage assigns to a named user OR a role. Role-based stages
  require an explicit "claim" before acting, preventing two role-holders acting concurrently.
- **Multi-tenancy**: shared schema, `tenant_id` scoping. Every query is scoped by the
  `tenant_id` embedded in the verified JWT — never a client-supplied value.
- **Notifications**: never sent inline. Enqueued to `notifications`; a background worker
  polls and sends with retry, so an SMTP hiccup never silently drops a notice.
- **Gaps resolved directly in Phase 1** (see source plan §4 for full rationale): template
  immutability via versioning, admin reassignment for stuck instances, clone-after-reject
  for resubmission, server-side upload validation (extension allow-list + size cap +
  signature check), queued notifications, a tenant-scoped "my tasks" view.

## 6. Security principles (non-negotiable, verified in Phase 5)

- **Secrets**: `JWT_SECRET`/DB/SMTP credentials from environment only; app refuses to boot
  if `JWT_SECRET` is missing or under 32 characters. `.env` git-ignored; `.env.example`
  (placeholders) committed.
- **Auth**: JWT, HS256 pinned explicitly at verification. `tenant_id`/`user_id`/`is_admin`
  read only from the verified token payload.
- **Authorization**: every route checks the actor's role/claim before acting
  (`requireAdmin`, `canAct()` in the workflow engine).
- **SQL injection**: all DB access via Knex query builder (parameterized); no string-built
  SQL anywhere. UUID-shaped inputs additionally format-validated before use.
- **Tenant isolation**: every query scoped by `tenant_id` from the JWT; no code path omits it.
- **Input validation**: required-field + UUID-format checks on POST bodies; multer enforces
  extension allow-list and size cap on uploads.
- **Transport/headers**: `helmet()`, CORS origin-allowlist (never `*`), TLS required for
  production Postgres.
- **Rate limiting**: baseline limiter on all routes; stricter limiter reserved for
  `/auth/login`.
- **Error handling**: central handler logs full detail server-side, returns a generic
  message to the client — no stack traces or DB error text.
- **Indexing**: every FK used in a join/lookup indexed; composite indexes match actual
  compound filters (`workflow_instances(tenant_id, status)`); `notifications(status)` indexed
  for the worker's poll query.
- **Auditability**: `stage_actions` records every action with actor, timestamp, comment;
  nothing is hard-deleted.

## 7. API design principles

Resource-oriented URLs (`/document-types`, `/workflow-templates`, `/instances`), correct
HTTP verbs, meaningful status codes (201/400/401/403/404), stateless requests (JWT + full
input, no server session), idempotency-aware state transitions (guarded by current-state
checks), consistent error shape (`{ error: string }`), route prefixes that leave room for
`/v2` later, and separation of concerns (routes = HTTP only, `src/services/workflowEngine.js`
= business rules).

## 8. Technology stack

- Backend: Node.js / Express
- Database: PostgreSQL via Knex (migrations + query builder, no raw SQL)
- Deployment (dev): Docker Compose (API + PostgreSQL)
- Email: SMTP via Nodemailer, queued and retried
- Security middleware: `helmet`, `cors` (origin allowlist), `express-rate-limit`
- Frontend: none in this build (deferred)

## 9. Phased plan and exit criteria

Carried over verbatim from the source plan; used as the checkpoint after each phase.

**Phase 0 — Foundations**: repo init, `.gitignore`, Docker Compose skeleton, Knex migration
tooling with migrations 001-010 run clean, JWT auth middleware with fail-fast secret
validation, tenant + role model, `helmet`/CORS/rate-limiting at app level, plus the
minimal `/auth/login` + seed script (this spec's addition).
*Exit criteria*: fresh clone + `npm install` + `npm run migrate` + `npm run dev` boots
cleanly and `/health` returns 200; `/auth/login` returns a valid JWT for a seeded user.

**Phase 1 — Template & workflow configuration**: admin API for template upload/versioning,
workflow builder (stages, assignment, allowed actions), document type CRUD, input
validation on admin POST bodies.
*Exit criteria*: an admin can fully configure a 3-stage workflow via API calls alone.

**Phase 2 — Workflow engine core**: start instance (template snapshot), claim flow,
download/upload save cycle, forward/send-back/hard-reject transitions (authorization
checked against stage assignee rules), admin reassignment, clone-after-reject.
*Exit criteria*: a document can be walked through a full multi-stage workflow via API
calls alone, including a send-back and a hard reject, with correct state at every step.

**Phase 3 — Notifications**: notifications queue + background worker (poll-and-send with
retry), per-event email templates, capped retry with `last_error` capture.
*Exit criteria*: every transition produces correct emails to correct recipients; a
simulated SMTP outage is retried, not dropped.

**Phase 4 — Dashboards & audit trail**: "my tasks" endpoint, instance detail (version
history + audit log), admin overview (filterable by status/type).
*Exit criteria*: any instance's full history is reconstructable from the API alone.

**Phase 5 — Hardening & QA**: upload validation checks (type/size/signature), tenant-isolation
testing, load test for index effectiveness, internal UAT.
*Exit criteria*: the security checklist (§6) fully verified against the running system.

## 10. Out of scope

Parallel/conditional stage routing, SLA/deadline escalation, in-browser document editing,
tenant branding on emails, automated test suite, `/auth/register` and password reset.

## 11. Open decision (deferred, not a blocker)

Send-back defaults to one-stage-back only; `target_stage_order` is stored explicitly in the
schema so jumping to any earlier stage can be added later without a migration.
