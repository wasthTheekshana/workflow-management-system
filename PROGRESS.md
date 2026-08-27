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
- **Next:** execute Phase 0 task-by-task, verify its exit criteria, report back, then
  write the Phase 1 plan (template & workflow configuration APIs).
