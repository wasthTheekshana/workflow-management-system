# Frontend Phase 3 — End-User Workflow UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining page stubs with the actual end-user path: see what's on your plate (My Tasks), start a new document, and act on one — download, upload, claim, forward, send back, reject, resubmit — with the full version history and audit log always visible.

**Architecture:** One `api/instances.ts` module (typed fetch functions for every `/instances/*` endpoint, mirroring the admin modules from Phase 2) consumed by three page components via TanStack Query. `InstanceDetailPage` computes which action buttons to show using a small client-side mirror of the backend's `canAct` logic — for UI convenience only; the backend's own `canAct` remains the actual authorization boundary regardless of what the UI shows.

**Tech Stack:** Same as Frontend Phases 1-2. One small **backend** addition: a non-admin, read-only document-types list endpoint (Task 1).

**Spec:** `docs/superpowers/specs/2026-08-28-frontend-design.md` (frontend); `docs/superpowers/specs/2026-08-27-workflow-engine-design.md` (backend, for Task 1's conventions).

## Global Constraints

- The client-side `canAct` mirror in `InstanceDetailPage` decides which buttons to *show*, never which actions are *allowed* — every mutation still goes through the real backend check, and a button the UI shouldn't have shown still fails safely with the backend's own error message if clicked (e.g., a role-holder who hasn't claimed yet). (Frontend spec §3, §5)
- Task 1's new endpoint follows every existing convention: `authenticate` only (no `requireAdmin` — this action is explicitly for any tenant member, matching where `POST /instances` itself already lives), `tenant_id` scoping via the existing `documentTypeService.listDocumentTypes`, tests before the route is wired in. (Backend spec §6, §7)
- Every mutation surfaces `ApiError.message` inline, never a generic failure message. (Frontend spec §5)

---

## Task 1: Backend — non-admin document-types list endpoint

**Files:**
- Create: `backend/src/routes/documentTypes.js`
- Modify: `backend/src/app.js` (mount the router)
- Test: `backend/tests/documentTypesPublic.test.js`

**Interfaces:**
- Produces: `GET /document-types` (authenticated, any tenant member, no admin requirement) — same shape and same tenant-scoped `listDocumentTypes(tenantId)` the admin route already uses. Frontend Task 2's `listStartableDocumentTypes` consumes it.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/documentTypesPublic.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ac000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ac000000-0000-0000-0000-000000000002';
const USER_ID = 'ac000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const userToken = signToken({ sub: USER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('GET /document-types (non-admin)', () => {
  let documentTypeId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Public Doc Types Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'pdt-admin@example.com', password_hash: 'x', is_admin: true },
        { id: USER_ID, tenant_id: TENANT_ID, email: 'pdt-user@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Public Doc Types Template' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Public Doc Types Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: USER_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Public Doc Type',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;
  });

  afterAll(async () => {
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app).get('/document-types');
    expect(response.status).toBe(401);
  });

  it('lets a non-admin tenant member list document types', async () => {
    const response = await request(app).get('/document-types').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(200);
    expect(response.body.some((d) => d.id === documentTypeId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/documentTypesPublic.test.js`
Expected: FAIL — route not found.

- [ ] **Step 3: Write `backend/src/routes/documentTypes.js`**

```js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { listDocumentTypes } = require('../services/documentTypeService');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const documentTypes = await listDocumentTypes(req.user.tenantId);
    res.status(200).json(documentTypes);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount the router in `backend/src/app.js`**

Add with the other route imports:
```js
const documentTypesPublicRouter = require('./routes/documentTypes');
```
Add with the other top-level mounts (near `/instances`):
```js
app.use('/document-types', documentTypesPublicRouter);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/documentTypesPublic.test.js`
Expected: PASS, 2 tests green.

- [ ] **Step 6: Run the full backend suite to confirm nothing broke, then commit**

Run: `npm test`
Expected: all suites pass (106 + 2 = 108).

```bash
cd "d:\Project\Workflow Managment System"
git add backend/src/routes/documentTypes.js backend/src/app.js backend/tests/documentTypesPublic.test.js
git commit -m "feat: add non-admin document-types list endpoint for the start-instance picker"
```

---

## Task 2: Frontend API module for instances

**Files:**
- Create: `frontend/src/api/instances.ts`

**Interfaces:**
- Produces: types (`WorkflowInstance`, `StageInfo`, `InstanceWithStage`, `MyTasksResponse`, `InstanceVersion`, `StageAction`, `InstanceHistory`) and functions `getMyTasks`, `startInstance`, `getInstance`, `claimInstance`, `uploadInstanceVersion`, `downloadCurrentFile`, `forwardInstance`, `sendBackInstance`, `rejectInstance`, `resubmitInstance`, `getInstanceHistory`, `listStartableDocumentTypes`. Tasks 3-5 consume all of these.

- [ ] **Step 1: Write `frontend/src/api/instances.ts`**

```ts
import { apiFetch, apiFetchBlob } from './client';

export interface WorkflowInstance {
  id: string;
  document_type_id: string;
  template_file_version_id: string;
  current_stage_order: number;
  status: 'in_progress' | 'completed' | 'rejected';
  claimed_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StageInfo {
  id: string;
  workflow_template_id: string;
  stage_order: number;
  name: string;
  assignee_type: 'user' | 'role';
  assignee_user_id: string | null;
  assignee_role_id: string | null;
  allowed_actions: string[];
}

export interface InstanceWithStage extends WorkflowInstance {
  currentStage: StageInfo;
}

export interface TaskListItem extends WorkflowInstance {
  document_type_name: string;
  currentStage?: StageInfo;
}

export interface MyTasksResponse {
  assignedToMe: TaskListItem[];
  waitingOnOthers: TaskListItem[];
  completed: TaskListItem[];
}

export interface InstanceVersion {
  id: string;
  workflow_instance_id: string;
  version_number: number;
  file_path: string;
  uploaded_by: string;
  created_at: string;
}

export interface StageAction {
  id: string;
  workflow_instance_id: string;
  action_type: string;
  from_stage_order: number | null;
  to_stage_order: number | null;
  actor_id: string;
  comment: string | null;
  created_at: string;
}

export interface InstanceHistory {
  instance: WorkflowInstance;
  documentType: { id: string; name: string };
  currentStage: StageInfo;
  versions: InstanceVersion[];
  auditLog: StageAction[];
}

export interface StartableDocumentType {
  id: string;
  name: string;
}

export function getMyTasks(): Promise<MyTasksResponse> {
  return apiFetch('/instances/my-tasks');
}

export function listStartableDocumentTypes(): Promise<StartableDocumentType[]> {
  return apiFetch('/document-types');
}

export function startInstance(documentTypeId: string): Promise<WorkflowInstance> {
  return apiFetch('/instances', { method: 'POST', body: JSON.stringify({ documentTypeId }) });
}

export function getInstance(id: string): Promise<InstanceWithStage> {
  return apiFetch(`/instances/${id}`);
}

export function claimInstance(id: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/claim`, { method: 'POST' });
}

export function uploadInstanceVersion(id: string, file: File): Promise<InstanceVersion> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch(`/instances/${id}/versions`, { method: 'POST', body: formData });
}

export function downloadCurrentFile(id: string): Promise<Blob> {
  return apiFetchBlob(`/instances/${id}/current-file`);
}

export function forwardInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/forward`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function sendBackInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/send-back`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function rejectInstance(id: string, comment?: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) });
}

export function resubmitInstance(id: string): Promise<WorkflowInstance> {
  return apiFetch(`/instances/${id}/resubmit`, { method: 'POST' });
}

export function getInstanceHistory(id: string): Promise<InstanceHistory> {
  return apiFetch(`/instances/${id}/history`);
}
```

- [ ] **Step 2: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/api/instances.ts
git commit -m "feat: add frontend API module for instance workflow actions"
```

---

## Task 3: My Tasks landing page

**Files:**
- Modify: `frontend/src/pages/MyTasksPage.tsx`

**Interfaces:** consumes Task 2's `getMyTasks`.

- [ ] **Step 1: Rewrite `frontend/src/pages/MyTasksPage.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMyTasks, TaskListItem } from '../api/instances';

function TaskCard({ task }: { task: TaskListItem }) {
  return (
    <Link
      to={`/instances/${task.id}`}
      className="block rounded border border-gray-200 bg-white p-4 text-sm hover:border-blue-300"
    >
      <div className="font-medium text-gray-900">{task.document_type_name}</div>
      <div className="mt-1 text-gray-600">
        {task.currentStage ? `Stage: ${task.currentStage.name}` : null} — status: {task.status}
      </div>
    </Link>
  );
}

function TaskSection({ title, tasks }: { title: string; tasks: TaskListItem[] }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">
        {title} ({tasks.length})
      </h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing here.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MyTasksPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['myTasks'], queryFn: getMyTasks });

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">My Tasks</h1>
        <Link
          to="/instances/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Start new document
        </Link>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">Failed to load your tasks.</p>}

      {data && (
        <>
          <TaskSection title="Assigned to Me" tasks={data.assignedToMe} />
          <TaskSection title="Waiting on Others" tasks={data.waitingOnOthers} />
          <TaskSection title="Completed" tasks={data.completed} />
        </>
      )}
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
git add frontend/src/pages/MyTasksPage.tsx
git commit -m "feat: build the My Tasks landing page"
```

---

## Task 4: Start a new document

**Files:**
- Modify: `frontend/src/pages/NewInstancePage.tsx`

**Interfaces:** consumes Task 2's `listStartableDocumentTypes`, `startInstance`.

- [ ] **Step 1: Rewrite `frontend/src/pages/NewInstancePage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { listStartableDocumentTypes, startInstance } from '../api/instances';
import { ApiError } from '../api/client';

export function NewInstancePage() {
  const navigate = useNavigate();
  const { data: documentTypes, isLoading } = useQuery({
    queryKey: ['startableDocumentTypes'],
    queryFn: listStartableDocumentTypes,
  });
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: () => startInstance(documentTypeId),
    onSuccess: (instance) => navigate(`/instances/${instance.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to start document'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startMutation.mutate();
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Start a Document</h1>

      {isLoading && <p className="text-sm text-gray-500">Loading document types...</p>}

      <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          Document type
          <select
            required
            value={documentTypeId}
            onChange={(e) => setDocumentTypeId(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">Select a document type</option>
            {documentTypes?.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={startMutation.isPending || !documentTypeId}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Start
        </button>
      </form>
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
git add frontend/src/pages/NewInstancePage.tsx
git commit -m "feat: build the start-a-document page"
```

---

## Task 5: Instance detail — actions and full history

**Files:**
- Modify: `frontend/src/pages/InstanceDetailPage.tsx`

**Interfaces:** consumes every function in Task 2's `instances.ts`; consumes `useAuth` (Frontend Phase 1) for the current user's ID.

- [ ] **Step 1: Rewrite `frontend/src/pages/InstanceDetailPage.tsx`**

```tsx
import { ChangeEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  claimInstance,
  downloadCurrentFile,
  forwardInstance,
  getInstance,
  getInstanceHistory,
  rejectInstance,
  resubmitInstance,
  sendBackInstance,
  StageInfo,
  uploadInstanceVersion,
  WorkflowInstance,
} from '../api/instances';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';

function canActLocally(stage: StageInfo, instance: WorkflowInstance, userId: string): boolean {
  if (instance.claimed_by) {
    return instance.claimed_by === userId;
  }
  if (stage.assignee_type === 'user') {
    return stage.assignee_user_id === userId;
  }
  return false;
}

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { decoded } = useAuth();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: Boolean(id),
  });
  const { data: history } = useQuery({
    queryKey: ['instanceHistory', id],
    queryFn: () => getInstanceHistory(id!),
    enabled: Boolean(id),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['instance', id] });
    queryClient.invalidateQueries({ queryKey: ['instanceHistory', id] });
    queryClient.invalidateQueries({ queryKey: ['myTasks'] });
  }

  function onError(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  const claimMutation = useMutation({
    mutationFn: () => claimInstance(id!),
    onSuccess: invalidateAll,
    onError: (err) => onError(err, 'Failed to claim'),
  });
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadInstanceVersion(id!, file),
    onSuccess: invalidateAll,
    onError: (err) => onError(err, 'Upload failed'),
  });
  const forwardMutation = useMutation({
    mutationFn: () => forwardInstance(id!, comment || undefined),
    onSuccess: () => {
      setComment('');
      invalidateAll();
    },
    onError: (err) => onError(err, 'Failed to forward'),
  });
  const sendBackMutation = useMutation({
    mutationFn: () => sendBackInstance(id!, comment || undefined),
    onSuccess: () => {
      setComment('');
      invalidateAll();
    },
    onError: (err) => onError(err, 'Failed to send back'),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectInstance(id!, comment || undefined),
    onSuccess: () => {
      setComment('');
      invalidateAll();
    },
    onError: (err) => onError(err, 'Failed to reject'),
  });
  const resubmitMutation = useMutation({
    mutationFn: () => resubmitInstance(id!),
    onSuccess: invalidateAll,
    onError: (err) => onError(err, 'Failed to resubmit'),
  });
  const downloadMutation = useMutation({
    mutationFn: () => downloadCurrentFile(id!),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'current-file.docx';
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => onError(err, 'Download failed'),
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    uploadMutation.mutate(file);
    event.target.value = '';
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!detail) return <p className="text-sm text-red-700">Instance not found.</p>;

  const instance = detail;
  const currentStage = detail.currentStage;
  const userId = decoded?.userId ?? '';
  const isMine = instance.status === 'in_progress' && canActLocally(currentStage, instance, userId);
  const canClaim =
    instance.status === 'in_progress' && currentStage.assignee_type === 'role' && !instance.claimed_by;
  const canResubmit = instance.status === 'rejected' && instance.created_by === userId;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-bold">
        {history?.documentType.name ?? 'Instance'}
      </h1>
      <p className="mb-6 text-sm text-gray-600">
        Stage: {currentStage.name} — status: {instance.status}
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => downloadMutation.mutate()}
          disabled={downloadMutation.isPending}
          className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
        >
          Download current file
        </button>

        {canClaim && (
          <button
            onClick={() => claimMutation.mutate()}
            disabled={claimMutation.isPending}
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
          >
            Claim
          </button>
        )}

        {isMine && (
          <label className="rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
            Upload new version
            <input type="file" onChange={handleFileChange} className="hidden" disabled={uploadMutation.isPending} />
          </label>
        )}

        {canResubmit && (
          <button
            onClick={() => resubmitMutation.mutate()}
            disabled={resubmitMutation.isPending}
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
          >
            Resubmit
          </button>
        )}
      </div>

      {isMine && (
        <div className="mb-6 rounded border border-gray-200 bg-white p-4">
          <label className="mb-3 block text-sm">
            Comment (optional)
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <div className="flex gap-2">
            {currentStage.allowed_actions.includes('forward') && (
              <button
                onClick={() => forwardMutation.mutate()}
                disabled={forwardMutation.isPending}
                className="rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
              >
                Forward
              </button>
            )}
            {currentStage.allowed_actions.includes('send_back') && instance.current_stage_order > 1 && (
              <button
                onClick={() => sendBackMutation.mutate()}
                disabled={sendBackMutation.isPending}
                className="rounded bg-yellow-600 px-3 py-2 text-sm text-white hover:bg-yellow-700"
              >
                Send Back
              </button>
            )}
            {currentStage.allowed_actions.includes('reject') && (
              <button
                onClick={() => {
                  if (window.confirm('Reject this document? This cannot be undone.')) {
                    rejectMutation.mutate();
                  }
                }}
                disabled={rejectMutation.isPending}
                className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
              >
                Reject
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="mb-6 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Version History</h2>
      <ul className="mb-6 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {history?.versions.map((version) => (
          <li key={version.id} className="px-4 py-3 text-sm">
            v{version.version_number} — {new Date(version.created_at).toLocaleString()}
          </li>
        ))}
        {history?.versions.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500">No versions uploaded yet.</li>
        )}
      </ul>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Audit Log</h2>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {history?.auditLog.map((action) => (
          <li key={action.id} className="px-4 py-3 text-sm">
            <span className="font-medium">{action.action_type}</span>
            {' — '}
            {new Date(action.created_at).toLocaleString()}
            {action.comment && <span className="block text-gray-600">"{action.comment}"</span>}
          </li>
        ))}
        {history?.auditLog.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500">No actions recorded yet.</li>
        )}
      </ul>
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
git add frontend/src/pages/InstanceDetailPage.tsx
git commit -m "feat: build instance detail page with actions and full history"
```

---

## Task 6: End-to-end verification

**Files:** none created — verification only, plus `PROGRESS.md`.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all 108 tests pass.

- [ ] **Step 2: Verify the frontend build one more time, clean**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds.

- [ ] **Step 3: Live-verify the exact request/response cycle every new screen depends on**

With both dev servers running, walk the same sequence the three new pages' forms and buttons will trigger — document-type discovery, start, download, upload, forward, send-back, reject, resubmit, history — via curl, exactly as done in Frontend Phase 2's verification. As in every prior frontend phase, no browser-automation tool is available in this environment, so the actual click-through cannot be performed by the agent — report this honestly and recommend the user spot-check it.

- [ ] **Step 4: Update `PROGRESS.md` and commit**

```bash
cd "d:\Project\Workflow Managment System"
git add PROGRESS.md
git commit -m "docs: update progress log for Frontend Phase 3 completion"
```
