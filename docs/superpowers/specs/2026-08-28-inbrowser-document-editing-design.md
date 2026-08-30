# In-Browser Document Editing (OnlyOffice) — Design Spec

Status: Approved for implementation
Scope: replaces the download → edit externally → re-upload step with real in-browser
`.docx` editing, for both admin template management and the end-user instance workflow.
Builds on the existing backend (`docs/superpowers/specs/2026-08-27-workflow-engine-design.md`)
and frontend (`docs/superpowers/specs/2026-08-28-frontend-design.md`).

## 1. Purpose

The original plan deliberately scoped out in-browser editing (§10: "In-browser document
editing (OnlyOffice/Collabora)") in favor of download/edit/re-upload, to ship faster.
The user now wants the real thing: an admin edits a master template directly in the
browser; an end user picks a document type, edits their instance's current file directly
in the browser, saves it (creating a new version, same as today's upload), and then
explicitly forwards/sends back/rejects/resubmits exactly as before.

## 2. Scope decisions

| Topic | Decision |
|---|---|
| Editor engine | OnlyOffice Document Server (Community Edition), self-hosted via Docker. Chosen over Collabora (simpler integration model: config + callback vs. full WOPI) and over a JS-only editor (no browser library edits real `.docx` with Word-level fidelity without risking corrupting formatting). |
| Editing scope | One editing mechanism used for both admin template-file editing and end-user instance editing — same frontend component, different save target. |
| Save vs. transition | Saving in the editor only creates a new version (`template_file_versions` or `instance_versions` row) — identical in effect to today's upload. Forward/Send Back/Reject/Resubmit remain separate, explicit user actions. |
| Coexistence with upload/download | The existing upload (`POST .../versions`) and download (`GET .../current-file`) endpoints and UI controls stay as-is. "Edit Online" is an additional path, not a replacement — if the Document Server is unreachable, the app still works via upload/download. |
| Secrets | A new `ONLYOFFICE_JWT_SECRET`, distinct from the app's own `JWT_SECRET` — the two systems are different trust boundaries and must never share a signing key. |

## 3. Architecture

```
Browser (OnlineEditor component)
   │  loads
   ▼
OnlyOffice Document Server JS API (served BY the Document Server itself)
   │  opens/edits, then on save:
   ▼
OnlyOffice Document Server (new Docker service)
   │  GET (fetch file to open)         │  POST (push saved file)
   ▼                                    ▼
Backend: GET /files/signed-download    Backend: POST /files/callback
   │                                    │  downloads saved bytes, validates,
   │  streams file bytes                │  creates a new version row
   ▼                                    ▼
Local disk storage (existing)          template_file_versions / instance_versions
```

The browser never talks to the Document Server's file-fetch or callback endpoints
directly — those are server-to-server (Document Server ↔ backend). The browser only
loads the Document Server's editor UI and JS API, using a config the backend built and
signed.

## 4. Backend design

### 4.1 New environment variables

- `ONLYOFFICE_JWT_SECRET` — signs/verifies every config and callback (fail-fast at boot
  if missing or under 32 characters, matching the existing `JWT_SECRET` pattern).
- `ONLYOFFICE_DOCUMENT_SERVER_URL` — the browser-reachable URL of the Document Server
  (e.g. `http://localhost:8082`), used by the frontend to load the editor JS API.
- `ONLYOFFICE_CALLBACK_BASE_URL` — the URL the Document Server (running in its own
  container) uses to reach this backend's API for file-fetch and callback requests.
  On local dev with the backend running on the host (not containerized) and the
  Document Server in Docker, this is `http://host.docker.internal:3000` (a Docker
  Desktop feature); in a fully-containerized deployment it would be the backend's
  service name on the shared Docker network.

### 4.2 Signed short-lived download tokens

A new utility signs a narrowly-scoped JWT (using the *app's own* `JWT_SECRET`, since
this token authenticates a resource fetch, not an OnlyOffice interaction) carrying
`{ filePath, exp }` with a short expiry (5 minutes — long enough for the Document
Server to fetch, useless if intercepted after). `GET /files/signed-download?token=...`
verifies it and streams exactly that file, nothing else — no directory listing, no
path outside what was explicitly signed.

### 4.3 Editor config endpoints

- `GET /admin/template-files/:id/edit-config` (admin-gated, tenant-scoped): builds a
  config for the template file's latest version. Mode is always `edit` — only admins
  reach this route at all, per the existing `requireAdmin` middleware.
- `GET /instances/:id/edit-config` (authenticated, tenant-scoped): builds a config for
  the instance's current file (latest `instance_versions` row, or the snapshotted
  template if none yet — same fallback `getCurrentFilePath` already uses). Mode is
  `edit` only if `canAct(stage, instance, userId)` is true (the same function that
  already gates upload/forward/etc.); otherwise `view`.

Each config includes: `document.url` (a signed download-token URL), `document.key`
(`<resourceType>-<resourceId>-<versionNumber>` — changes every save, so the Document
Server never serves stale cached content), `document.fileType: 'docx'`,
`document.title`, `editorConfig.callbackUrl` (the resource-specific callback URL, built
from `ONLYOFFICE_CALLBACK_BASE_URL`), `editorConfig.mode`, `editorConfig.user` (id +
name for co-editing display). The whole config is signed as `config.token` per
OnlyOffice's own JWT security model, using `ONLYOFFICE_JWT_SECRET`.

### 4.4 Save callback

`POST /files/callback/template-files/:id` and `POST /files/callback/instances/:id`:
verify the OnlyOffice-signed JWT (`ONLYOFFICE_JWT_SECRET`) on the request; on
`status === 2` (document ready to save) or `status === 6` (force-save), fetch the
saved file from the `url` the callback body provides (a plain HTTP GET — this URL is
the Document Server's own ephemeral storage, not user-controlled), run it through the
**existing** `assertAllowedUpload` check, and create a new version row using a
buffer-based save function shared with the existing multer-upload path (refactored out
of `templateFileService.addTemplateFileVersion` / `workflowInstanceService.addInstanceVersion`
so there is exactly one place that decides "how a new version gets created," fed by
either a multer `file` object or a downloaded `Buffer`). Responds `{ error: 0 }` per
OnlyOffice's expected callback contract (any other shape is treated as a failure by
the Document Server and it retries).

### 4.5 Security

- The callback endpoint trusts nothing but the verified JWT — no user session, no
  admin check, because the Document Server itself has no user identity to present.
  This is standard for OnlyOffice/WOPI-style integrations: the trust boundary is
  "this request is cryptographically provable to have come from our configured
  Document Server," not "this specific user is authorized" (that check already
  happened when the edit-config was issued with `mode: edit`).
- The download token is scoped to one file path and expires in 5 minutes — it cannot
  be reused to browse other tenants' files or after the editing session ends.
- `docker-compose.yml`'s Document Server service binds to `127.0.0.1` only, same
  convention as the existing Postgres/API port bindings (Phase 0's hardening fix).

## 5. Frontend design

- `OnlineEditor.tsx`: a component that dynamically loads
  `${ONLYOFFICE_DOCUMENT_SERVER_URL}/web-apps/apps/api/documents/api.js` (can't be
  bundled — it's served by the Document Server itself and differs per deployment),
  then instantiates `new DocsAPI.DocEditor(containerId, config)` with the config
  fetched from the backend's edit-config endpoint. Unmounts cleanly (destroys the
  editor instance) when navigated away.
- `TemplateFileDetailPage`: an "Edit Online" button opens the editor in place of (or
  alongside, via a toggle) the versions list; closing it refetches the template file
  detail so the new version appears.
- `InstanceDetailPage`: an "Edit Online" button appears wherever "Upload new version"
  already appears (i.e., `isMine`); same open/close/refetch pattern.

## 6. Out of scope

Real-time co-editing UX polish (presence indicators beyond what OnlyOffice provides
by default), commenting/track-changes surfaced in our own UI, converting other file
types (PDF, xlsx) — this build stays `.docx`-only, matching the existing upload
validation.

## 7. Delivery phases

- **Backend Phase (OnlyOffice-1)**: Docker service, env config, signed download
  tokens, edit-config endpoints, callback endpoint, refactored shared version-save
  function, tests (the callback flow is testable without a real Document Server by
  simulating its signed callback request and its ephemeral file-serving with a small
  local HTTP fixture).
- **Frontend Phase (OnlyOffice-2)**: `OnlineEditor` component, wiring into
  `TemplateFileDetailPage` and `InstanceDetailPage`.
