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
- **User confirmed the running system looked good** after both servers were
  started and spot-checked, then asked to continue straight to Frontend Phase 3.
- **Wrote and executed Frontend Phase 3 — end-user workflow UI**
  (`docs/superpowers/plans/2026-08-28-frontend-phase3-instance-workflow-ui.md`):
  a real My Tasks landing page, a start-a-document flow, and the instance detail
  screen — download/upload/claim/forward/send-back/reject/resubmit — with full
  version history and audit log always visible.
  - **Another small, flagged backend addition:** `POST /instances` (starting a
    document) is explicitly a non-admin action, but the only endpoint that listed
    document types to pick from was `GET /admin/document-types` (admin-gated) —
    a regular user could start an instance if they already knew the UUID, but
    couldn't discover it. Added `GET /document-types` (authenticated only, no
    `requireAdmin`, reusing the existing tenant-scoped service function) — the
    same shape of gap as Phase 2's users/roles endpoints, same fix pattern.
  - `InstanceDetailPage` mirrors the backend's own `canAct` logic client-side to
    decide which action buttons to *show* — never to decide what's *allowed*.
    Every mutation still goes through the real backend check regardless.
  - **Caught a real bug via the build step, not a browser:** the first draft
    destructured `const { instance, currentStage } = detail` from
    `GET /instances/:id`, but that endpoint returns the instance flattened with
    `currentStage` attached directly (`{ ...instance, currentStage }`), not
    nested under an `instance` key. `npm run build`'s TypeScript check failed
    immediately on `Property 'instance' does not exist` — exactly the kind of
    contract mismatch a browser click-through might not catch quickly if the
    page happened to still render something. Fixed and reflected in the plan
    doc too.
  - **Verified exit criteria:** backend suite → 108/108 passing; frontend build
    clean; a full live walkthrough — discover document types → start → download
    → upload → forward (completed the instance, since this test workflow has
    only one stage) → attempted send-back/reject on the now-completed instance
    → confirmed both correctly rejected with the exact `{error: "..."}` messages
    the UI's error banner displays → `GET /instances/:id/history` reconstructed
    the complete story. Same browser-automation caveat as every prior frontend
    phase, flagged rather than glossed over.

## Where things stand

Both the backend (all 6 phases, 108 tests) and the frontend (app shell/auth,
admin config, end-user workflow UI) are functionally complete against the
original scope. What's left, if the user wants it: a manual browser
click-through pass (the one thing this environment can't automate), and
anything from the backend's own out-of-scope list (§10 of the source plan) —
`/auth/register`, password reset, parallel/conditional stage routing, SLA
escalation, in-browser document editing, tenant branding on emails — none of
which were asked for.

## In-browser document editing (OnlyOffice) — new scope, explicitly requested

- **User asked for real in-browser `.docx` editing** — admin edits a template
  directly in the browser; an end user edits their instance's current file in
  the browser and saves it (creating a new version, same as an upload) before
  explicitly forwarding. This is exactly the item the source plan's §10 had
  called out of scope ("In-browser document editing (OnlyOffice/Collabora)")
  — a real scope expansion, not a bug fix, so it went through brainstorming
  again rather than straight into code.
  - Design questions resolved with the user: OnlyOffice Document Server
    (self-hosted, Docker) over Collabora (simpler config+callback integration
    vs. full WOPI) and over a JS-only editor (no browser library edits real
    `.docx` with Word-level fidelity without risking corrupting formatting);
    one editing mechanism for both admin templates and user instances; saving
    stays separate from Forward/Send Back/Reject — editing only replaces the
    download/upload step, not the workflow transitions.
  - Spec: `docs/superpowers/specs/2026-08-28-inbrowser-document-editing-design.md`.
- **Wrote and executed OnlyOffice-1 (backend integration)**
  (`docs/superpowers/plans/2026-08-28-onlyoffice-1-backend-integration.md`):
  a new `onlyoffice/documentserver` Docker service; a `downloadToken` utility
  (short-lived, narrowly-scoped JWTs so the Document Server can fetch a file
  without a user session); `GET /files/signed-download`; a
  `documentEditingService` that builds and signs OnlyOffice editor configs for
  both template files (admin, always edit-mode) and instances (edit-mode only
  when the caller's own `canAct` check passes, otherwise view-only — reusing
  the exact function the engine itself uses); `GET /admin/template-files/:id/edit-config`
  and `GET /instances/:id/edit-config`; a `POST /files/callback/*` pair that
  downloads a saved file from the Document Server and creates a new version,
  through the same validation the existing upload path uses.
  - **Refactored before adding the callback**, not after: extracted
    `saveTemplateFileVersionBuffer`/`saveInstanceVersionBuffer` out of the
    existing multer-based upload functions so there is exactly one place that
    decides "how a version gets created" — fed by either a multer file or a
    buffer downloaded from the editor's callback. Verified the refactor alone
    changed nothing (existing tests green) before building the new callback
    path on top of it.
  - **Automated security review caught a real, serious vulnerability**, not a
    style nit: `downloadToken.js` signed its short-lived file tokens with the
    *same* `JWT_SECRET` as user session tokens, with no claim distinguishing
    the two token types. A leaked download token fed into `authenticate()`
    would pass `jwt.verify()` cleanly and produce
    `req.user = { userId: undefined, tenantId: undefined, isAdmin: false }` —
    and Knex silently drops `undefined` keys from `.where()` clauses, so
    *every* tenant-scoped query in the app would have lost its tenant filter
    entirely for that request. Fixed two ways: `authenticate()` now requires
    `sub`/`tenant_id` to actually be present before trusting a token, and
    download tokens carry a `purpose: 'file-download'` claim checked on every
    verify — so a token issued for one purpose can never be replayed as the
    other, even sharing a signing secret. Also added a resolved-path check in
    the signed-download route as defense-in-depth against path traversal,
    though the current call site was never actually reachable with untrusted
    input.
  - **Verified exit criteria:** full test suite → 122/122 passing, including a
    save-callback test that stands up a real local HTTP fixture server (no
    mocking library) to play the role of the Document Server's ephemeral
    "here's the saved file" URL.
- **A second, more thorough automated security pass on the same commit found
  the fix above wasn't the whole story.** Two more findings on
  `filesCallback.js`: (1) **authorization-bypass** — the callback trusted
  `req.query.tenantId`/`actorUserId` outright and treated *any* JWT signed
  with `ONLYOFFICE_JWT_SECRET` as sufficient proof of authenticity. Since the
  client-facing edit-config response (`config.token`) is signed with that
  same secret and handed to any authenticated user who fetches an
  edit-config, that token could be replayed directly at the callback
  endpoint with an arbitrary tenant/actor/resource in the query string — a
  full bypass letting any user inject a version onto any tenant's document.
  (2) **SSRF** — `downloadSavedBuffer` fetched `req.body.url` with no
  restriction at all, so a forged callback could make the backend fetch
  arbitrary internal hosts or cloud metadata endpoints.
  - Fixed both together, not piecemeal: a *separate*, resource-bound
    callback token (`purpose` + `resourceType` + `resourceId` + `tenantId` +
    `actorUserId`) is now minted only when an edit session is genuinely
    edit-mode — a view-only session can never obtain one, closing the
    escalation path at the source rather than patching around it. The
    callback route verifies both this token (proves authorization for this
    exact resource) and the Document-Server-signed relay token (proves the
    status/url payload genuinely came through the editor's own callback
    mechanism), reading status/url from the verified relay payload rather
    than raw `req.body`. The SSRF fix requires the download URL's hostname
    to match a configured OnlyOffice host and refuses to follow redirects —
    the two ways a naive host check gets bypassed.
  - **Verified exit criteria:** full suite → 125/125 passing, including new
    tests proving a callback token scoped to the wrong resource is rejected,
    a missing callback token is rejected even with a valid relay token, and
    an SSRF attempt at a cloud metadata address (`169.254.169.254`) is
    refused before any download happens.
- **Pulled and started the real OnlyOffice Document Server** and verified
  the entire pipeline against it live, not simulated: the Document Server's
  welcome page responds; a fresh edit-config's signed `document.url`
  resolves to the real `.docx` bytes; a properly-shaped simulated save
  callback pointed at non-`.docx` content was correctly rejected by the
  signature check; and a callback pointed at the real signed-download URL
  (simulating an actual editor save) took the template file's version count
  from 1 to 2 — the complete real flow, working end to end.
- **Wrote and executed OnlyOffice-2 (frontend embed)**
  (`docs/superpowers/plans/2026-08-28-onlyoffice-2-frontend-embed.md`): an
  `OnlineEditor` component that dynamically loads the Document Server's own
  JS API script (can't be bundled — it's served by that service, and its URL
  differs per deployment) and instantiates `DocsAPI.DocEditor` with a config
  fetched from OnlyOffice-1's edit-config endpoints; wired an "Edit Online"
  button into both `TemplateFileDetailPage` (admin) and `InstanceDetailPage`
  (end user), additive alongside the existing upload/download controls, not
  replacing them.
  - Caught and fixed a real bug myself before it reached anyone: the error
    banner on the instance page was initially placed inside the
    `{!editorConfig && (...)}` block, meaning an editor-load failure (which
    fires while `editorConfig` is still set) would never actually display —
    moved it above both branches so it's visible regardless of which one is
    showing.
  - **Verified exit criteria:** backend suite → 125/125 passing (unchanged,
    this phase touched no backend code); frontend `npm run build` stayed
    clean through both wiring changes; the exact script URL `OnlineEditor`
    injects (`http://localhost:8082/web-apps/apps/api/documents/api.js`)
    returns `200` against the real running Document Server. As with every
    frontend phase, no browser-automation tool exists in this environment,
    so the actual editor UI rendering and a live type-and-save round trip
    couldn't be watched directly — flagged rather than glossed over.

## In-browser document editing: complete

Both halves of the feature the user explicitly asked for are done: the
backend integration (config signing, signed downloads, the save callback,
and the two-round security hardening that followed) and the frontend embed.
Recommend a manual browser pass — open a template file or an in-progress
instance you can act on, click Edit Online, make a change, and confirm it
saves as a new version — since that's the one thing automated checks in this
environment can't cover.
