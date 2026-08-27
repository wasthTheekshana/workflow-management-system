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
- **Next:** write and execute the Phase 3 plan (notifications — queue table, background
  worker with poll-and-send retry, per-event email templates for assigned/forwarded/
  sent-back/rejected/completed/reassigned).
