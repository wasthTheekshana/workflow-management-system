# OnlyOffice-2 — Frontend Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin and end-user screens a real "Edit Online" button that opens the OnlyOffice editor in place, alongside the existing upload/download controls — completing the feature the backend half (OnlyOffice-1) already supports.

**Architecture:** `api/documentEditing.ts` fetches a signed editor config from the backend's edit-config endpoints. `OnlineEditor.tsx` dynamically loads the Document Server's own JS API script (it can't be bundled — it's served by the Document Server, and its URL differs per deployment) and instantiates `DocsAPI.DocEditor` with that config. `TemplateFileDetailPage` and `InstanceDetailPage` each hold a small bit of local state (which config, if any, is currently open) and toggle between their existing content and the embedded editor.

**Tech Stack:** Same as prior frontend phases. One new env var: `VITE_ONLYOFFICE_DOCUMENT_SERVER_URL` (the browser-facing Document Server URL — distinct from the backend's `ONLYOFFICE_CALLBACK_BASE_URL`, which the browser never talks to).

**Spec:** `docs/superpowers/specs/2026-08-28-inbrowser-document-editing-design.md`

## Global Constraints

- The Document Server's JS API script is loaded dynamically at runtime from `VITE_ONLYOFFICE_DOCUMENT_SERVER_URL`, never bundled — its URL is deployment-specific and the script itself is served by that service, not npm. (Spec §5)
- "Edit Online" is additive, not a replacement — the existing upload/download controls stay exactly as they are on both pages. (Spec §2 "Coexistence with upload/download")
- The editor component owns only its own embed lifecycle (load the API once, instantiate, destroy on unmount/close) — it does not know or care whether it's editing a template file or an instance; that distinction lives entirely in which edit-config endpoint the page fetched from. (Frontend spec §3, isolation principle)
- Closing the editor always refetches the underlying page's data (`templateFile` / `instance` + `instanceHistory` query keys) so a saved version appears immediately, exactly like the existing upload flow already does via `invalidateQueries`.

---

## Task 1: Editor config API module and the `OnlineEditor` component

**Files:**
- Create: `frontend/src/api/documentEditing.ts`
- Create: `frontend/src/components/OnlineEditor.tsx`
- Modify: `frontend/.env.example` and `frontend/.env` (new variable)

**Interfaces:**
- Produces: `OnlyOfficeConfig` type, `getTemplateEditConfig(templateFileId) -> Promise<OnlyOfficeConfig>`, `getInstanceEditConfig(instanceId) -> Promise<OnlyOfficeConfig>`; `<OnlineEditor config={...} onClose={...} />`. Tasks 2 and 3 consume all of these.

- [ ] **Step 1: Add the new env variable**

Append to `frontend/.env.example`:
```dotenv
VITE_ONLYOFFICE_DOCUMENT_SERVER_URL=http://localhost:8082
```
Add the same line to the real `frontend/.env`.

- [ ] **Step 2: Write `frontend/src/api/documentEditing.ts`**

```ts
import { apiFetch } from './client';

export interface OnlyOfficeDocumentConfig {
  fileType: string;
  key: string;
  title: string;
  url: string;
}

export interface OnlyOfficeEditorConfig {
  mode: 'edit' | 'view';
  callbackUrl?: string;
  user: { id: string; name: string };
}

export interface OnlyOfficeConfig {
  document: OnlyOfficeDocumentConfig;
  editorConfig: OnlyOfficeEditorConfig;
  token: string;
}

export function getTemplateEditConfig(templateFileId: string): Promise<OnlyOfficeConfig> {
  return apiFetch(`/admin/template-files/${templateFileId}/edit-config`);
}

export function getInstanceEditConfig(instanceId: string): Promise<OnlyOfficeConfig> {
  return apiFetch(`/instances/${instanceId}/edit-config`);
}
```

- [ ] **Step 3: Write `frontend/src/components/OnlineEditor.tsx`**

```tsx
import { useEffect, useId, useRef } from 'react';
import { OnlyOfficeConfig } from '../api/documentEditing';

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (containerId: string, config: OnlyOfficeConfig) => { destroyEditor: () => void };
    };
  }
}

const DOCUMENT_SERVER_URL = import.meta.env.VITE_ONLYOFFICE_DOCUMENT_SERVER_URL as string;

let apiScriptPromise: Promise<void> | null = null;

function loadOnlyOfficeApi(): Promise<void> {
  if (window.DocsAPI) {
    return Promise.resolve();
  }
  if (!apiScriptPromise) {
    apiScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${DOCUMENT_SERVER_URL}/web-apps/apps/api/documents/api.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the document editor'));
      document.body.appendChild(script);
    });
  }
  return apiScriptPromise;
}

interface OnlineEditorProps {
  config: OnlyOfficeConfig;
  onClose: () => void;
  onError: (message: string) => void;
}

export function OnlineEditor({ config, onClose, onError }: OnlineEditorProps) {
  const containerId = `oo-editor-${useId().replace(/:/g, '')}`;
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadOnlyOfficeApi()
      .then(() => {
        if (cancelled || !window.DocsAPI) return;
        editorRef.current = new window.DocsAPI.DocEditor(containerId, config);
      })
      .catch(() => onError('Could not load the document editor. Is the editor service running?'));

    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
    // Re-run only if the resource being edited actually changes (its key
    // changes every save), not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.document.key]);

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">Editing: {config.document.title}</span>
        <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900">
          Close
        </button>
      </div>
      <div id={containerId} style={{ height: '80vh' }} />
    </div>
  );
}
```

- [ ] **Step 4: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/.env.example frontend/src/api/documentEditing.ts frontend/src/components/OnlineEditor.tsx
git commit -m "feat: add OnlyOffice editor config API module and OnlineEditor component"
```

---

## Task 2: Wire "Edit Online" into the admin template file screen

**Files:**
- Modify: `frontend/src/pages/admin/TemplateFileDetailPage.tsx`

**Interfaces:** consumes `getTemplateEditConfig` and `<OnlineEditor>` (Task 1).

- [ ] **Step 1: Rewrite `frontend/src/pages/admin/TemplateFileDetailPage.tsx`**

```tsx
import { ChangeEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTemplateFile, uploadTemplateFileVersion } from '../../api/templateFiles';
import { getTemplateEditConfig, OnlyOfficeConfig } from '../../api/documentEditing';
import { OnlineEditor } from '../../components/OnlineEditor';
import { ApiError } from '../../api/client';

export function TemplateFileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editorConfig, setEditorConfig] = useState<OnlyOfficeConfig | null>(null);

  const { data: templateFile, isLoading } = useQuery({
    queryKey: ['templateFile', id],
    queryFn: () => getTemplateFile(id!),
    enabled: Boolean(id),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadTemplateFileVersion(id!, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templateFile', id] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Upload failed'),
  });

  const editConfigMutation = useMutation({
    mutationFn: () => getTemplateEditConfig(id!),
    onSuccess: (config) => {
      setError(null);
      setEditorConfig(config);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not open the editor'),
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    uploadMutation.mutate(file);
    event.target.value = '';
  }

  function closeEditor() {
    setEditorConfig(null);
    queryClient.invalidateQueries({ queryKey: ['templateFile', id] });
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!templateFile) return <p className="text-sm text-red-700">Template file not found.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{templateFile.name}</h1>

      {editorConfig ? (
        <OnlineEditor config={editorConfig} onClose={closeEditor} onError={setError} />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => editConfigMutation.mutate()}
              disabled={editConfigMutation.isPending || templateFile.versions.length === 0}
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Edit Online
            </button>
            <label className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
              Upload new version
              <input type="file" onChange={handleFileChange} className="hidden" disabled={uploadMutation.isPending} />
            </label>
          </div>

          <h2 className="mb-2 text-sm font-semibold text-gray-700">Versions</h2>
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
            {templateFile.versions.map((version) => (
              <li key={version.id} className="px-4 py-3 text-sm">
                v{version.version_number} — uploaded {new Date(version.created_at).toLocaleString()}
              </li>
            ))}
            {templateFile.versions.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-500">No versions uploaded yet.</li>
            )}
          </ul>
        </>
      )}

      {error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/pages/admin/TemplateFileDetailPage.tsx
git commit -m "feat: add Edit Online to the admin template file detail page"
```

---

## Task 3: Wire "Edit Online" into the instance detail screen

**Files:**
- Modify: `frontend/src/pages/InstanceDetailPage.tsx`

**Interfaces:** consumes `getInstanceEditConfig` and `<OnlineEditor>` (Task 1).

- [ ] **Step 1: Add the edit-online state and mutation to `frontend/src/pages/InstanceDetailPage.tsx`**

Add to the imports:
```tsx
import { getInstanceEditConfig, OnlyOfficeConfig } from '../api/documentEditing';
import { OnlineEditor } from '../components/OnlineEditor';
```

Add alongside the other `useState` calls:
```tsx
const [editorConfig, setEditorConfig] = useState<OnlyOfficeConfig | null>(null);
```

Add alongside the other mutations:
```tsx
const editConfigMutation = useMutation({
  mutationFn: () => getInstanceEditConfig(id!),
  onSuccess: (config) => {
    setError(null);
    setEditorConfig(config);
  },
  onError: (err) => onError(err, 'Could not open the editor'),
});

function closeEditor() {
  setEditorConfig(null);
  invalidateAll();
}
```

- [ ] **Step 2: Add the "Edit Online" button and conditionally render the editor**

Add the button next to the existing "Upload new version" control (inside the `{isMine && ( ... )}` block that already wraps it):
```tsx
{isMine && (
  <button
    onClick={() => editConfigMutation.mutate()}
    disabled={editConfigMutation.isPending}
    className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
  >
    Edit Online
  </button>
)}
```

Wrap the page's existing action-buttons block, comment form, and history sections so they're replaced by the editor when one is open — at the top of the returned JSX, right after the heading/status paragraph, add:
```tsx
{editorConfig && <OnlineEditor config={editorConfig} onClose={closeEditor} onError={setError} />}
```
and wrap everything from the action-buttons `<div>` through the end of the audit log `<ul>` in `{!editorConfig && ( ... )}` so the editor and the rest of the page are mutually exclusive, matching the template file page's pattern.

- [ ] **Step 3: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/pages/InstanceDetailPage.tsx
git commit -m "feat: add Edit Online to the instance detail page"
```

---

## Task 4: End-to-end verification

**Files:** none created — verification only, plus `PROGRESS.md`.

- [ ] **Step 1: Run the backend test suite (regression check — this phase touches no backend code)**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all 125 tests still pass.

- [ ] **Step 2: Verify the frontend build one more time, clean**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds.

- [ ] **Step 3: Verify the Document Server's JS API script is actually fetchable from the browser-facing URL**

With the Document Server running (`docker compose up -d onlyoffice` in `backend/`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8082/web-apps/apps/api/documents/api.js
```
Expected: `200` — this is the exact URL `OnlineEditor.tsx` injects as a `<script src>`.

- [ ] **Step 4: Manual verification note**

As with every prior frontend phase, no browser-automation tool is available in this environment. Rendering the actual OnlyOffice editor UI, opening a document, typing an edit, and confirming the save round-trip visually cannot be performed by the agent. What **is** verified automatically: the config the button fetches is proven correct (OnlyOffice-1's live tests already proved the edit-config and callback endpoints work end to end against the real Document Server), the script URL the component loads is reachable, and the build compiles cleanly with the new component wired into both pages. Recommend the user open both pages in a real browser and click "Edit Online" once convenient.

- [ ] **Step 5: Update `PROGRESS.md` and commit**

```bash
cd "d:\Project\Workflow Managment System"
git add PROGRESS.md
git commit -m "docs: update progress log for OnlyOffice frontend embed completion"
```
