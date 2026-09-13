# Self-Service Documents — Design Spec

Status: Approved for implementation

## 1. Purpose

Starting an ad-hoc workflow today still requires an admin to have pre-created a
`document_types` row in `'adhoc'` mode pointing at an admin-uploaded `template_files`
row — a regular user can build their own stage list, but only against a document an
admin set up in advance. This spec lets any authenticated user upload a `.docx` or
compose a rich-text document themselves, right when they start a workflow, with no
admin involvement — matching how they can already build the stage list themselves.

The uploaded/composed document is one-off, scoped to that single instance — the same
philosophy already established for ad-hoc `workflow_templates` (a private, never-reused
row set created per instance, not a reusable library entry).

## 2. Data model

- `document_types.is_adhoc` — new boolean, not null, default `false`. Mirrors
  `workflow_templates.is_adhoc` (added in the ad-hoc-workflows sub-project) exactly,
  for exactly the same reason: distinguishing a one-off row created behind the scenes
  from a real, admin-curated entry an admin should see and manage.
- `template_files.is_adhoc` — same addition, same reasoning, for the one-off template
  file this flow creates.
- `documentTypeService.listDocumentTypes` (admin) and `templateFileService.listTemplateFiles`
  (admin) both add `.andWhere({ is_adhoc: false })` to their existing query — this is the
  one-line fix that was needed retroactively for `workflow_templates` last time; doing it
  up front here avoids repeating that mistake. The existing public
  `GET /document-types` (`listStartableDocumentTypes`, used by "Start a Document") is
  **unaffected** — self-service document types are never meant to be picked from that
  list anyway, since they're created and consumed atomically in the same request (see
  §3) and never persist as a separate "pick me" option.

No other schema changes. `workflow_instances`, `workflow_templates`, `workflow_stages`
are untouched — this flow produces rows in exactly the same shape existing code already
knows how to consume.

## 3. Backend — one atomic endpoint

`POST /instances/from-document` (multipart/form-data, since a `.docx` upload may be
present), mounted on the existing `/instances` router (so `authenticate` already
applies — any authenticated user, not just admins).

Request fields:
- `name` — the document/workflow's title (required, non-empty).
- `contentFormat` — `'docx' | 'richtext'` (required).
- `file` — the uploaded `.docx`, required when `contentFormat === 'docx'`, must be
  absent otherwise.
- `content` — a JSON-stringified rich-text document, required when
  `contentFormat === 'richtext'`, must be absent otherwise.
- `stages` — a JSON-stringified array, same shape and validation as the existing
  ad-hoc `stages` input (`{ name, assigneeType: 'user'|'group', assigneeId }[]`).

New service function `startInstanceFromOwnDocument(tenantId, userId, isAdmin, { name, contentFormat, file, content, stages })`
in `workflowInstanceService.js`:

1. Validate `name` (non-empty string) and `contentFormat` (one of the two values) before
   opening a transaction.
2. Validate the format-specific payload: for `docx`, `assertAllowedUpload(file, ['docx'], MAX_TEMPLATE_UPLOAD_BYTES)`
   (same constants `templateFileService.js` already uses); for `richtext`, `content` must
   be a JSON object (same check `addTemplateFileContentVersion` already does).
3. Inside one `db.transaction(trx => ...)`:
   a. Insert a one-off `template_files` row: `{ tenant_id, name, content_format: contentFormat, is_adhoc: true }`.
   b. Insert its version 1 into `template_file_versions`: for `docx`, save the buffer via
      the existing `saveUploadedFile` (already used by `saveTemplateFileVersionBuffer` —
      call it directly with `trx` substituted for `db` inline here, rather than
      threading a new `trx` parameter through `templateFileService`'s exported
      functions, which stay admin-only and untouched) and insert `{ file_path,
      uploaded_by: userId }`; for `richtext`, insert `{ content: JSON.stringify(content),
      uploaded_by: userId }`.
   c. Insert a one-off `document_types` row: `{ tenant_id, name, template_file_id: <from
      3a>, workflow_mode: 'adhoc', workflow_template_id: null, is_adhoc: true }`, using
      the same defaults `documentTypeService.createDocumentType` already falls back to
      when they're omitted (`allowed_extensions: ['docx']`,
      `max_upload_size_bytes: 10485760`) — `addInstanceVersion` (unchanged) reads these
      from the document type on every later revision upload for a `docx`-format
      instance, ad-hoc or not, so they need real values, not placeholders.
   d. Call the existing `createAdhocWorkflowTemplate(trx, tenantId, userId, isAdmin,
      { name }, stages)` — already accepts a `trx` and already does 100% of the stage
      validation/creation/visibility-scoping this flow needs, unchanged.
   e. Insert the `workflow_instances` row exactly as `startInstance`'s existing ad-hoc
      branch does: `document_type_id` (3c), `template_file_version_id` (3b),
      `workflow_template_id` (3d), `current_stage_order: 1`, `status: 'in_progress'`,
      `created_by: userId`.
4. Outside the transaction, fire the existing first-stage `notifyStage` call, identical
   to `startInstance`'s existing post-transaction step.

Every downstream operation on the resulting instance — `forwardInstance`, `claimInstance`,
`getInstanceDetail`, comments, the document panel — needs zero changes: it's a normal
`workflow_instances` row referencing a normal (if freshly one-off) `document_types` /
`workflow_template_id`, exactly the shape every existing function already expects.

## 4. Frontend

- `RichTextEditor.tsx` gains one new optional prop, `onChange?: (content: unknown) =>
  void`, wired through Tiptap's `onUpdate: ({ editor }) => onChange?.(editor.getJSON())`.
  Backward compatible — every existing caller that omits it is unaffected.
- New `frontend/src/api/instances.ts` export:
  ```ts
  export function startInstanceFromOwnDocument(input: {
    name: string;
    contentFormat: 'docx' | 'richtext';
    file?: File;
    content?: unknown;
    stages: AdhocStageInput[];
  }): Promise<WorkflowInstance>
  ```
  builds a `FormData` (name, contentFormat, file or JSON-stringified content,
  JSON-stringified stages) and posts it — `apiFetch` already special-cases a `FormData`
  body (skips the JSON `Content-Type` header), matching the existing
  `uploadTemplateFileVersion` pattern.
- `NewInstancePage.tsx` gains a top-level mode radio: "Use an existing document type"
  (today's entire existing flow, unchanged) vs. "Start from my own document" (new). The
  new mode: a title `<input>`, a format radio (upload `.docx` / write rich text), the
  matching input (a file `<input>`, or an inline `<RichTextEditor>` with `editable`
  and `onChange` wired to local state, `onSave` omitted since there's nothing to persist
  until the whole form submits), then the exact same stage-builder block (add/remove
  rows, person/group radio, visibility-scoped assignee `<select>`) the existing ad-hoc
  branch already renders — factored into a shared `StageBuilder` component so the two
  modes don't duplicate that JSX (this is the one internal refactor this spec asks for,
  since both modes now need the identical block).

## 5. Out of scope

- Editing the one-off document's content again before the workflow starts (compose
  once, submit; post-start editing already exists via the instance's document panel).
- Making the self-service document reusable/discoverable by other users afterward — by
  design (§1), it's one-off.
- Any change to the existing "use an existing document type" flow's behavior.
- Role as an assignee type in this flow's stage builder — matches the existing ad-hoc
  restriction (user/group only) exactly, no new decision needed here.

## 6. Testing

Backend integration tests (new `backend/tests/instances.fromDocument.test.js`): docx
path — upload a valid buffer, 2 stages, assert 201 and that `GET /instances/:id` returns
the new instance with `contentFormat: 'docx'` and a working `current-file` download;
richtext path — same, asserting `contentFormat: 'richtext'` and `current-content`
returns the submitted JSON; validation — missing `stages` → 400, `contentFormat: 'docx'`
with no `file` → 400, `contentFormat: 'richtext'` with non-object `content` → 400, an
invalid `stages[].assigneeId` (outside visibility) → 400, matching the existing ad-hoc
validation test shapes; confirm the created `document_types`/`template_files` rows have
`is_adhoc: true` and are excluded from `GET /admin/document-types` and
`GET /admin/template-files`. Frontend: `tsc -b` clean, then manual click-through — start
one workflow via docx upload and one via rich-text composition, each with 2 stages,
confirm both land on the instance detail page with a working document panel and the
first assignee gets notified.
