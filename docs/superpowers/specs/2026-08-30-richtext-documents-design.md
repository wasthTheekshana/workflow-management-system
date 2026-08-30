# Rich-Text Document Templates & Instances — Design Spec

Status: Approved for implementation
Scope: a second content format for templates and instances — rich text (Notion/Google-Docs-style),
alongside the existing `.docx` file format. Builds on the backend spec
(`docs/superpowers/specs/2026-08-27-workflow-engine-design.md`) and the OnlyOffice spec
(`docs/superpowers/specs/2026-08-28-inbrowser-document-editing-design.md`).

## 1. Purpose

Every template file today is a real `.docx` binary, edited either by download/upload or by
OnlyOffice in-browser editing. The user wants a second option: a template whose content is
composed directly in a native rich-text editor (headings, lists, bold/italic, alignment) —
no Word file involved at all — using the exact same admin-creates-a-template →
user-starts-an-instance → edits → forwards pattern the rest of the system already has.

## 2. Scope decisions

| Topic | Decision |
|---|---|
| Relationship to `.docx`/OnlyOffice | Additive, not a replacement. Every template file gets a `content_format` (`docx` or `richtext`), fixed at creation. `docx` templates work exactly as they do today (upload, download, Edit Online via OnlyOffice) — completely untouched by this feature. |
| Where the format lives | On `template_files`, not `document_types` — the format is a property of the template's content itself. An instance's format is always inherited from its document type's template file. |
| Storage | Rich-text content is a JSON document (from the frontend editor's native JSON representation), stored directly in Postgres (`jsonb`) — no file, no disk storage, no external service. |
| Versioning | Reuses the exact same `template_file_versions` / `instance_versions` tables and version-numbering logic already in place — a version row now holds *either* `file_path` *or* `content`, never both, matching its template's format. |
| Template gallery | Out of scope. Admins compose rich-text templates the same way they create any template today — no pre-built starter library. |
| Editor library | TipTap (a well-documented, actively maintained React rich-text editor built on ProseMirror) — the frontend spec's stack (React + TypeScript) already fits it directly. |

## 3. Data model changes

- `template_files` gains `content_format` (`'docx' | 'richtext'`, `NOT NULL DEFAULT 'docx'`) —
  every existing row defaults to `docx`, so nothing already built is affected.
- `template_file_versions` and `instance_versions` each gain a nullable `content` (`jsonb`)
  column; `file_path` on both becomes nullable. A `CHECK` constraint on each table enforces
  that **exactly one** of `file_path` / `content` is set per row — the database itself
  refuses a row that's ambiguous or empty, rather than relying on application code alone.

## 4. Backend design

### 4.1 Template files

- `POST /admin/template-files` accepts an optional `contentFormat` (`'docx' | 'richtext'`,
  defaults to `'docx'`), validated against the same two values as the DB constraint.
- `POST /admin/template-files/:id/versions` (existing, multipart) now rejects with 400 if
  the template's `content_format` isn't `'docx'` — "this template doesn't accept file
  uploads."
- `POST /admin/template-files/:id/content-versions` (new, JSON body `{ content }`): rejects
  with 400 if the template's `content_format` isn't `'richtext'`; otherwise creates a new
  version exactly like the file-upload path does, just with `content` instead of a saved
  file — same version-numbering logic, reused, not duplicated.
- `GET /admin/template-files/:id` (existing) is unchanged in shape — its `versions` array
  now simply has some rows with `file_path` and others with `content`, depending on the
  template's format.

### 4.2 Instances

- `POST /instances/:id/versions` (existing, multipart) rejects with 400 if the instance's
  document type's template file isn't `'docx'`-formatted.
- `POST /instances/:id/content-versions` (new, JSON body `{ content }`): the same
  authorization checks `addInstanceVersion` already applies (status `in_progress`,
  `canAct`), rejecting with 400 if the format isn't `'richtext'`.
- `GET /instances/:id/current-content` (new): returns `{ content }` for the instance's
  latest content version, or the snapshotted template version's content if none yet exists —
  mirroring `getCurrentFilePath`'s fallback exactly, just for JSON instead of a file stream.
- `GET /instances/:id` (existing) gains a `contentFormat` field in its response so the
  frontend can decide which editing UI to show without a second round-trip.

### 4.3 OnlyOffice endpoints

`buildTemplateEditConfig` and `buildInstanceEditConfig` (from the OnlyOffice integration)
now reject with 400 if the target's `content_format` isn't `'docx'` — Edit Online never
applies to a rich-text document; that's what the new content endpoints are for.

## 5. Frontend design

- `RichTextEditor.tsx`: a TipTap-based editor with a toolbar (heading level, bold/italic/
  underline/strikethrough, bullet/ordered/task lists, text alignment, undo/redo) and an
  explicit **Save** button — saving calls the content-version endpoint and refetches the
  page's data, the same "save is a distinct action, never automatic" pattern the rest of
  the app already follows for uploads.
- `TemplateFilesPage`: the create-template form gains a format choice (Upload a Word
  document / Compose in the editor); choosing the editor path creates the template with
  `contentFormat: 'richtext'` and no initial file.
- `TemplateFileDetailPage`: branches on `templateFile.content_format` — `docx` templates
  keep exactly the UI already built (Edit Online, Upload new version, version list);
  `richtext` templates show the `RichTextEditor` loaded with the latest version's content
  (or empty, for a brand-new template) instead.
- `InstanceDetailPage`: branches on the instance's `contentFormat` the same way — `docx`
  instances keep Edit Online/Upload/Download exactly as built; `richtext` instances show
  the `RichTextEditor` in the same `isMine`-gated slot Edit Online/Upload currently occupy.

## 6. Out of scope

Template galleries/starter libraries, real-time collaborative editing (TipTap supports it
but it needs a sync server — not warranted here), rich-text-to-`.docx` export, comments/
mentions within rich-text content, converting an existing `docx` template to `richtext` or
vice versa (format is fixed at creation).
