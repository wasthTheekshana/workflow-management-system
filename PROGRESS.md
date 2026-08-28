# Workflow Engine — Build Progress

Running log of what's been built, why, and what's next. Updated as work happens, not
after the fact. Full spec: `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`.
Plans: `docs/superpowers/plans/`.

## 2026-08-27

- **Read the source plan** (`Workflow_Engine_Implementation_Plan.docx`) and turned it into
  a formal spec at `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`.
  Why: the docx isn't diffable/reviewable in the same way, and a few gaps in it needed
  explicit resolution before coding (see below).
- **Scope decisions locked in with the user:**
  - Backend only for now; React frontend deferred to its own later project — the plan's
    own phase exit criteria are all API-only ("via API calls alone").
  - Added a minimal `POST /auth/login` + dev seed script in Phase 0, even though the
    source plan lists `/auth/login` as "out of scope for Phase 1" — because the plan
    also says it "must be built before go-live" and nothing else is testable without it.
    No `/auth/register` or password reset; those stay out of scope.
  - Building and checkpointing phase-by-phase (0 → 1 → 2 → 3 → 4 → 5), verifying each
    phase's own exit criteria before moving on, rather than building all phases blind.
  - Docker Compose for local Postgres (confirmed Docker is installed on this machine).
- **Wrote the Phase 0 implementation plan**
  (`docs/superpowers/plans/2026-08-27-phase0-foundations.md`): repo scaffolding, Docker
  Compose, all 10 schema migrations, fail-fast env validation, JWT sign/verify pinned to
  HS256, auth middleware, helmet/CORS/rate-limiting, and `/auth/login` + seed script.
  - Caught and fixed a real bug during self-review: the first draft set
    `ssl: { rejectUnauthorized: false }` for production Postgres connections, which
    disables TLS certificate verification (MITM risk) — directly contradicting the
    spec's own "production Postgres connections require TLS by default" principle.
    Fixed to `ssl: true` (verification stays on); a self-signed cert should go through
    the trust store, not a disabled check.
- **Executed Phase 0 task-by-task** (git-committed one task at a time in `backend/`):
  repo scaffolding, Docker Compose (Postgres 16 + API), all 10 schema migrations,
  fail-fast env validation, JWT sign/verify pinned to HS256, AppError + central error
  handler + auth middleware, Express app (helmet/CORS/rate-limit) + `/health`,
  `POST /auth/login`, and the dev seed script + server entrypoint.
  - Chose to execute directly in this session rather than the full subagent-driven
    orchestration (worktrees + a reviewer subagent per task + ledger). Why: solo local
    build, no shared branch, and the plan already carried literal code for every step —
    the multi-agent review pipeline is built for larger/parallel efforts and would have
    added ceremony without adding rigor here.
  - **Automated security review of each commit caught and fixed 2 real issues:**
    1. Docker hardening: API container ran as root, had no `.dockerignore` (risk of
       `.env`/`.git` leaking into the image), Postgres/API ports bound to all
       interfaces, and Compose fell back to a weak hardcoded DB password if `.env`
       was missing. Fixed: non-root `node` user in the container, `.dockerignore`
       added, ports bound to `127.0.0.1` only, `DB_PASSWORD` now required (fails
       loudly, no weak fallback).
    2. Tenant isolation gap in the schema itself: child tables used single-column
       foreign keys (e.g. `user_roles.user_id -> users.id`), which let a row
       reference a parent belonging to a *different* tenant — the database had no way
       to reject that, only application code did. Fixed by adding `unique(tenant_id, id)`
       to every referenced table and converting every cross-table FK to a composite
       `(tenant_id, id)` foreign key, so the database itself now enforces the spec's
       tenant-isolation principle (§6), not just the JWT-scoped query pattern in app code.
       Rebuilt both databases from a clean volume and reran all 10 migrations clean.
  - **Verified exit criteria from a clean volume:** `docker compose down -v` → migrate →
    seed → `npm run dev` boots cleanly; `GET /health` → 200; `POST /auth/login` with
    seeded credentials → 200 + JWT; wrong password → generic 401 `{"error":"Invalid
    email or password"}` (no detail leaked); full test suite → 19/19 passing.
- **Wrote and executed the Phase 1 plan**
  (`docs/superpowers/plans/2026-08-27-phase1-template-workflow-config.md`): admin-only
  APIs (`authenticate` + new `requireAdmin` middleware) for template files (create,
  list, get, upload/version with extension allow-list + size cap + ZIP magic-byte
  signature check, local disk storage), workflow templates (create, list, get) with a
  stage builder (`POST /admin/workflow-templates/:id/stages`, user- or role-assigned,
  ordered, cross-tenant-checked), and full document type CRUD linking a template file
  to a workflow template.
  - Switched `multer` from the plan's originally-specified 1.x to 2.x mid-task: `npm
    install` surfaced a deprecation warning that 1.x has known vulnerabilities patched
    in 2.x. Since the spec requires security best practices as a hard constraint, not
    just what the plan happened to name, upgraded before writing any code against it.
  - Every admin service function validates cross-tenant references itself (a
    `templateFileId`, `workflowTemplateId`, `assigneeUserId`, or `assigneeRoleId` must
    belong to the caller's own tenant) — this is the application-layer half of the
    tenant-isolation principle; Phase 0's composite FKs are the database-layer half.
  - **Verified exit criteria:** full test suite → 44/44 passing; a live end-to-end curl
    walkthrough created a template file, uploaded two versions, built a 3-stage workflow
    (mixing user- and role-assignable stages), and linked a document type to both —
    entirely through the API, no direct database access.
- **Wrote and executed the Phase 2 plan**
  (`docs/superpowers/plans/2026-08-27-phase2-workflow-engine-core.md`): the workflow
  engine core — `startInstance`, claim flow for role-assigned stages, the
  download/upload save-version cycle (validated against the document type's own
  `allowed_extensions`/`max_upload_size_bytes`), forward (auto-completes at the last
  stage), send-back (always exactly one stage back, per the spec's open decision),
  hard reject, clone-after-reject resubmission, and admin reassignment for stuck
  instances.
  - Centralized every transition's authorization in one pure function, `canAct(stage,
    instance, userId)` (named to match the spec's own "canAct() in the workflow
    engine" reference), instead of duplicating the check per action: if the instance
    is claimed, only the claimant may act — which is also what makes admin
    reassignment work uniformly across both role- and user-assigned stages without
    a separate code path.
  - Admin reassignment is scoped to the single stuck instance (`claimed_by`) —
    deliberately never rewrites the workflow template's stage definition, so fixing
    one stuck document can't silently change how every other instance of that
    template behaves.
  - Hit a real supertest quirk while testing the binary download endpoint: superagent
    doesn't buffer unrecognized content-types (like a .docx mimetype) into a Buffer by
    default, so `response.body` came back as `{}` instead of file bytes. Fixed by
    parsing the response with an explicit binary parser in the tests — not an app bug,
    but worth remembering for any future binary-download test.
  - **Verified exit criteria:** full test suite → 66/66 passing; a live curl
    walkthrough drove one instance through start → download → re-upload → forward →
    send-back → forward → forward → hard reject → resubmit, with correct state
    (`current_stage_order`, `status`, `claimed_by`) confirmed at every step.
- **Resumed after a context compaction** and confirmed the in-flight tenant-isolation
  fix from the end of Phase 0 (converting every cross-table FK in migrations 002-010 to
  a composite `(tenant_id, id)` foreign key) was already committed and applied cleanly
  to both databases — verified via `knex migrate:list` before continuing, per the
  memory-verification discipline (don't trust a stale record of "what's in the repo").
- **Wrote and executed the Phase 3 plan**
  (`docs/superpowers/plans/2026-08-27-phase3-notifications.md`): SMTP config +
  Nodemailer transporter, a `notificationService` (recipient resolution — a single
  user or every role-holder — plus per-event templates for assigned/forwarded/
  sent_back/rejected/completed/reassigned), wired that service into every Phase 2
  transition as a side effect (never sent inline), and a background worker
  (`processPendingNotifications`) that polls `WHERE status = 'pending'`, attempts
  delivery through an injectable `sendMail`, and caps retries at `MAX_ATTEMPTS = 5`
  before marking a row `'failed'`.
  - **Security review caught a real gap:** the initial Nodemailer transporter didn't
    force STARTTLS or pin a minimum TLS version, leaving it open to a downgrade
    attack that strips encryption on the plaintext-then-upgrade path. Fixed by
    requiring STARTTLS by default (`SMTP_REQUIRE_TLS`, opt-out only for a
    non-TLS-capable local dev relay) and pinning `tls.minVersion: 'TLSv1.2'`; also
    trimmed worker error logging to `err.message` only, not the full error object,
    as defense-in-depth against a verbose SMTP response echoing sensitive detail
    into logs.
  - Nodemailer itself was bumped from the plan's originally-specified 6.x to 9.x
    mid-task — `npm audit` flagged eight CVEs (SMTP command injection, CRLF header
    injection, TLS certificate validation bypass) patched only in the major version.
    Same pattern as multer in Phase 1: verify the actual dependency, not just what
    the plan named.
  - A schema consequence of Phase 0's tenant-isolation fix showed up immediately:
    `notifications.workflow_instance_id` is now a composite FK, so a notification
    test using a fabricated instance ID correctly failed instead of silently
    inserting — fixed by using `null` (the column is nullable) for tests that only
    exercise recipient/template logic, not a real instance lifecycle.
  - **Verified exit criteria:** full test suite → 77/77 passing; a live walkthrough
    (start, forward, reject) confirmed one `notifications` row per transition, and
    with no real SMTP server reachable, the running worker's poll cycle left every
    row `status: 'pending'` while `attempts` climbed and `last_error` captured the
    real `ECONNREFUSED` — proving an outage delays delivery rather than dropping it.
## 2026-08-28

- **Wrote and executed the Phase 4 plan**
  (`docs/superpowers/plans/2026-08-28-phase4-dashboards-audit-trail.md`): a new
  `dashboardService.js` (read-only, separate from the transactional engine) adding
  `GET /instances/my-tasks`, `GET /instances/:id/history`, and
  `GET /admin/instances?status=&documentTypeId=`.
  - The spec names the three "my tasks" buckets but doesn't define their exact
    membership — documented the design call in the plan: *assigned to me* reuses
    Phase 2's own `canAct` (plus "eligible to claim" for an unclaimed role stage),
    *waiting on others* is the caller's own in-progress submissions sitting at
    someone else's desk, *completed* is the caller's own submissions that reached a
    terminal state (`completed` or `rejected`). Reusing `canAct` here means the
    dashboard can never claim someone is "assigned" to something they couldn't
    actually act on — one source of truth for authorization, not two.
  - `GET /instances/my-tasks` had to be registered before the existing
    `GET /instances/:id` route — Express matches routes in declaration order, so
    `:id` would otherwise have swallowed `my-tasks` as a param value. Caught by the
    route ordering itself failing loudly in the first test run.
  - **Verified exit criteria:** full test suite → 87/87 passing; a live walkthrough
    confirmed `/instances/:id/history` reconstructs the complete version list and
    audit log for an instance forwarded then sent back, `/instances/my-tasks`
    correctly bucketed both this phase's fresh instance and leftover instances from
    every earlier phase's own walkthrough still sitting in the dev database, and
    `/admin/instances?status=in_progress` filtered correctly.
- **Wrote and executed the Phase 5 plan**
  (`docs/superpowers/plans/2026-08-28-phase5-hardening-qa.md`): the final phase, pure
  verification against the *running* system rather than new features.
  - **Upload validation**: closed two real gaps — oversized files and
    signature-mismatched files (a `.docx`-named upload whose bytes aren't actually
    a ZIP) were previously proven only at the unit level (`fileValidation.test.js`);
    added endpoint-level tests for both, on both the template-file admin upload and
    the instance version upload, so the whole path (multer → `assertAllowedUpload` →
    reject) is proven live, not just the validator function in isolation.
  - **Tenant isolation**: a single comprehensive sweep test builds two fully
    independent tenants and drives every admin CRUD action, every instance
    transition, and every list endpoint from tenant A against tenant B's real
    resource IDs — 9 tests, all passing, meaning the composite-FK fix from Phase 0
    and the tenant-scoped `WHERE` clause in every service function actually hold
    end-to-end, not just individually per phase.
  - **Rate limiting & injection**: proved the login limiter's 429 fires on exactly
    the 11th attempt (not sooner, not never), and that a literal SQL-injection
    string (`Robert'); DROP TABLE workflow_templates;--`) round-trips as inert data
    through Knex's parameterized queries — the table survives, the string comes
    back byte-for-byte on a subsequent list call.
  - **Index effectiveness**: bulk-seeded 8,000 rows each into `workflow_instances`
    and `notifications` (via a single `INSERT ... SELECT generate_series(...)`, not
    one row at a time) with a realistic status distribution — mostly terminal
    states so `in_progress`/`pending` are a selective minority, the shape a real
    tenant's data would actually have — then ran `EXPLAIN` and confirmed the
    planner chose an index scan over a sequential scan for both the tenant
    dashboard query and the notification worker's poll query.
  - **Verified exit criteria:** full test suite → 103/103 passing. Live checks
    against the running system: the app refuses to boot with a short `JWT_SECRET`,
    a tampered JWT gets a 401, helmet headers are present on a live response,
    malformed/missing input returns a generic `{ "error": ... }` with no stack
    trace. Ran a full realistic UAT-style walkthrough (HR Letter, 3 stages,
    including a send-back and a revision) end to end via the API — since there's
    no frontend in this build's scope, this scripted run stands in for the
    plan's "internal UAT with one real DOK workflow" until a UI exists for a human
    to click through by hand — and `GET /instances/:id/history` reconstructed the
    complete, correctly-ordered story: 2 versions, 4 audit-log entries with the
    right actors and comments.

## Backend status: the source plan's Phase 1 (all 6 phases) is complete

Every phase in `Workflow_Engine_Implementation_Plan.docx` — Foundations, Template &
Workflow Configuration, Workflow Engine Core, Notifications, Dashboards & Audit
Trail, and Hardening & QA — has been built, tested, and verified against the running
system. 103 tests passing across 30 suites. What remains out of scope for the
backend itself, per the source plan's own §10 and the scope decisions recorded above:
`/auth/register` and password reset, parallel/conditional stage routing, SLA
escalation, in-browser document editing, and tenant branding on emails.

## Frontend

- **Brainstormed and wrote the frontend design spec**
  (`docs/superpowers/specs/2026-08-28-frontend-design.md`): React + Vite +
  TypeScript + Tailwind, TanStack Query for all server data, React Router, JWT in
  `localStorage`, full coverage (login, admin config, end-user workflow UI), built
  checkpoint-by-feature-area to mirror the backend's phase rhythm. Decided against a
  separate automated frontend test suite for this first build — the backend's 103
  tests already prove API correctness; frontend verification is `npm run build`
  (catches TypeScript errors) plus live checks against the real running backend at
  each checkpoint.
- **Wrote and executed Frontend Phase 1 — app shell & auth**
  (`docs/superpowers/plans/2026-08-28-frontend-phase1-app-shell-auth.md`): scaffolded
  the whole project, an `apiClient` (typed `ApiError`, auto-logout on 401, separate
  `apiFetchBlob` for file downloads), an `AuthContext` decoding the JWT client-side
  for UI branching only (never the authorization boundary — the backend's
  `requireAdmin` still gates every admin call), `ProtectedRoute`/`AdminRoute` guards,
  the login page, and every route this build will ever have — including admin
  screens — wired as stubs now so later phases touch one file each instead of also
  doing routing work.
  - No browser-automation tool is available in this environment, so full
    interactive click-through (submitting the login form, watching the redirect)
    could not be performed by the agent — recorded honestly rather than claimed.
    What *was* verified: `npm run build` compiles clean across all 20+ new files,
    the dev server serves `/` with the correct title, and — critically — a live
    CORS preflight from `http://localhost:5173` against the real backend returned
    `Access-Control-Allow-Origin: http://localhost:5173`, and the exact login
    request the form sends returned a valid token. The two things most likely to
    silently break a freshly wired frontend (compile errors, CORS misconfiguration)
    are the two things checked without a browser.
- **Wrote and executed Frontend Phase 2 — admin config screens**
  (`docs/superpowers/plans/2026-08-28-frontend-phase2-admin-config.md`): template
  file upload/versioning, the workflow template stage builder, and document type
  CRUD — the same admin configuration path the backend's own Phase 1 exit criteria
  proved via curl, now with a UI.
  - **Small backend addition, flagged before doing it:** the stage builder needs to
    let an admin pick a user or role as a stage assignee, but the backend had no
    endpoint to list a tenant's users/roles — never part of the original plan,
    since users/roles were only ever seeded directly. Without it, the admin would
    paste raw UUIDs into a text box. Added `GET /admin/users` and `GET /admin/roles`
    (read-only, same tenant/admin-scoped pattern as every other admin route,
    `password_hash` never selected) — small, justified, tested (3 new tests,
    106 total backend tests now).
  - Each admin resource got its own typed `api/*.ts` module (mirroring Phase 1's
    `api/auth.ts`) consumed directly by page components via TanStack Query — no
    separate hooks layer, since a one-line wrapper around each query would be a
    file that adds indirection without adding value.
  - **Verified exit criteria:** backend suite → 106/106 passing; frontend
    `npm run build` stayed clean through all three admin screens (100 modules).
    Same browser-automation gap as Phase 1 — flagged again rather than glossed
    over — but this time verified something stronger than Phase 1's proof-of-contract
    check: the *exact* request/response cycle each screen's form actually performs
    (create template file → upload version → create workflow template → add a
    user-assigned stage → create a document type linking both) was run end-to-end
    against the real backend and every response matched what the UI code expects.
- **Next:** write and execute Frontend Phase 3 (end-user workflow UI — my-tasks
  landing page, start-instance flow, instance detail with download/upload/claim/
  forward/send-back/reject/resubmit actions, and the full history view) —
  recommend the user spot-check the admin screens and login flow in an actual
  browser once convenient, since that's the one piece automated checks in this
  environment can't cover.
