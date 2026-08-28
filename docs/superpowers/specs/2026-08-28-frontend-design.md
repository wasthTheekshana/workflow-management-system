# Workflow Engine Frontend — Design Spec

Status: Approved for implementation
Scope: a complete, usable web UI for the existing backend (`Workflow_Engine_Implementation_Plan.docx`
Phase 1, backend spec at `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`).
Covers login, admin configuration, and the end-user workflow UI.

## 1. Purpose

Give the workflow engine's backend (fully built and hardened across Phases 0-5) a usable
face: an admin configures document types/workflows/templates, and end users start, act
on, and track documents through their configured workflow — without touching the API
directly.

## 2. Scope decisions

| Topic | Decision |
|---|---|
| Coverage | Everything the backend supports: login, admin config screens, and the end-user instance workflow UI (my tasks, act on instances, history). |
| Stack | React + Vite + TypeScript + Tailwind CSS. |
| Data fetching | TanStack Query for all server state (caching, loading/error states, mutations). |
| Routing | React Router. |
| Token storage | JWT in `localStorage` (no refresh-token endpoint exists server-side, so in-memory-only would log users out on every refresh). |
| Build cadence | Checkpoint by feature area — app shell/auth, then admin config, then instance workflow UI, then dashboards — verified in a real browser at each stage, mirroring the backend's phase rhythm. |
| Automated tests | None for this first build. The backend already has 103 tests proving API correctness; frontend verification is manual, in a real browser, at each checkpoint. |

## 3. Architecture

Single-page app served by Vite's dev server locally (`npm run dev` in `frontend/`),
built to static assets for deployment (`npm run build`). Talks only to the existing
backend API (`backend/`, already running on `http://localhost:3000`), never touches
the database directly.

- **`apiClient`**: a thin wrapper around `fetch`. Attaches `Authorization: Bearer <token>`
  from `localStorage` to every request. Throws a typed `ApiError` on any non-2xx response,
  carrying the backend's `{ error: string }` message. On a 401, clears the stored token
  and redirects to `/login` — the same trigger whether the token expired or was never
  valid.
- **TanStack Query hooks**: one hook per resource (`useMyTasks`, `useInstance`,
  `useTemplateFiles`, etc.), each calling `apiClient` and returning the library's
  standard `{ data, isLoading, error }` shape. Mutations (start instance, forward,
  upload version, create document type, ...) invalidate the relevant query keys on
  success so the UI reflects the new state without a manual refetch.
- **Auth context**: a small React context holding the decoded token (`{ userId,
  tenantId, isAdmin }`, decoded client-side for UI branching only — never trusted as
  an authorization boundary, since the backend enforces that independently) and
  `login`/`logout` functions. A route guard component redirects to `/login` when
  there's no token, and a separate guard hides `/admin/*` routes from non-admins
  client-side (again, UX only — the backend's `requireAdmin` is the real gate).

## 4. Pages and components

- **`/login`** — email/password form, posts to `POST /auth/login`, stores the token,
  redirects to `/my-tasks`.
- **`/my-tasks`** (landing page) — three sections from `GET /instances/my-tasks`
  (Assigned to Me, Waiting on Others, Completed), each instance card showing document
  type, current stage, and status, linking to `/instances/:id`. A "Start new document"
  button links to `/instances/new`.
- **`/instances/new`** — a document-type picker (fetched from a lightweight admin
  document-types list, readable by any authenticated user for this purpose) and a
  "Start" button calling `POST /instances`.
- **`/instances/:id`** — instance detail: document type, current stage, status. A
  "Download current file" button (fetch + Blob, since the endpoint needs the auth
  header). An "Upload new version" file input, shown only when the instance's own
  state indicates the current viewer can act (derived from the same fields the
  backend's `canAct` uses: stage assignee vs. `claimed_by` vs. current user).
  Action buttons — Claim (role stages only), Forward, Send Back, Reject, Resubmit
  (rejected instances only) — each a mutation with a confirmation for destructive
  ones (Reject). Below: full version history and the stage-actions audit log from
  `GET /instances/:id/history`, always visible to any tenant member.
- **`/admin/template-files`** — list + "New template file" form (name only).
- **`/admin/template-files/:id`** — name, version list (version number, uploaded by,
  date), an "Upload new version" file input.
- **`/admin/workflow-templates`** — list + "New workflow template" form (name only).
- **`/admin/workflow-templates/:id`** — name, ordered stage list, an "Add stage" form
  (order, name, assignee type, assignee user or role picker, allowed actions).
- **`/admin/document-types`** — list with inline edit/delete, "New document type" form
  (name, template file picker, workflow template picker, allowed extensions, max
  size).
- **`/admin/instances`** — table of all tenant instances, filterable by status and
  document type, with a "Reassign" action per in-progress row (target user picker).

## 5. Error handling

Every mutation surfaces `ApiError.message` (the backend's own `{ error }` text) in an
inline alert near the action that failed — never a generic "something went wrong."
A global 401 handler in `apiClient` covers session expiry uniformly rather than every
screen handling it separately.

## 6. Out of scope

Automated frontend tests, offline support, real-time updates (polling/websockets),
responsive/mobile-specific layouts beyond basic Tailwind responsiveness, i18n,
accessibility audit beyond semantic HTML defaults.
