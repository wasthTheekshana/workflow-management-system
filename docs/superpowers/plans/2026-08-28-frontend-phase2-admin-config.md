# Frontend Phase 2 — Admin Config Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin page stubs from Frontend Phase 1 with working screens: template file upload/versioning, the workflow template stage builder, and document type CRUD — everything an admin needs to fully configure a workflow, matching what the backend's own Phase 1 exit criteria proved via curl.

**Architecture:** One `api/<resource>.ts` module per backend resource (typed fetch functions, mirroring `api/auth.ts`'s pattern), consumed directly by page components via TanStack Query's `useQuery`/`useMutation` — no separate hooks layer, since each hook would be a one-line wrapper adding a file without adding value. Mutations invalidate the relevant query key on success so lists refresh without a manual reload.

**Tech Stack:** Same as Frontend Phase 1. One small **backend** addition: two read-only admin endpoints needed for the stage-assignee picker (see Task 1).

**Spec:** `docs/superpowers/specs/2026-08-28-frontend-design.md` (frontend); `docs/superpowers/specs/2026-08-27-workflow-engine-design.md` (backend, for the Task 1 addition's conventions).

## Global Constraints

- Every admin page assumes the viewer already passed `AdminRoute` (Frontend Phase 1) — no page re-checks `isAdmin` itself; the backend's `requireAdmin` remains the real gate regardless. (Frontend spec §3)
- Every mutation surfaces `ApiError.message` inline near the control that triggered it — never a generic failure message. (Frontend spec §5)
- The Task 1 backend addition follows every existing convention exactly: `authenticate` + `requireAdmin`, `tenant_id` scoping, a service function separate from the route handler, tests before the route is wired in. (Backend spec §6, §7)

---

## Task 1: Backend — read-only admin users/roles list endpoints

**Files:**
- Create: `backend/src/services/userService.js`
- Create: `backend/src/services/roleService.js`
- Create: `backend/src/routes/admin/users.js`
- Create: `backend/src/routes/admin/roles.js`
- Modify: `backend/src/app.js` (mount both routers)
- Test: `backend/tests/adminUsers.test.js`
- Test: `backend/tests/adminRoles.test.js`

**Interfaces:**
- Produces: `listUsers(tenantId) -> Promise<user[]>` (id, email, full_name, is_admin — never `password_hash`), `listRoles(tenantId) -> Promise<role[]>` (id, name); `GET /admin/users`, `GET /admin/roles`, both admin-gated and tenant-scoped. The frontend's stage-assignee picker (Task 4) consumes both.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/adminUsers.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'aa000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'aa000000-0000-0000-0000-000000000002';
const OTHER_USER_ID = 'aa000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const userToken = signToken({ sub: OTHER_USER_ID, tenant_id: TENANT_ID, is_admin: false });

describe('GET /admin/users', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Users Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'au-admin@example.com', password_hash: 'x', is_admin: true },
        { id: OTHER_USER_ID, tenant_id: TENANT_ID, email: 'au-user@example.com', password_hash: 'x', full_name: 'Other User' },
      ])
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects a non-admin', async () => {
    const response = await request(app).get('/admin/users').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
  });

  it("lists the tenant's users without password hashes", async () => {
    const response = await request(app).get('/admin/users').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.some((u) => u.id === OTHER_USER_ID && u.full_name === 'Other User')).toBe(true);
    expect(response.body.every((u) => u.password_hash === undefined)).toBe(true);
  });
});
```

```js
// backend/tests/adminRoles.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ab000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ab000000-0000-0000-0000-000000000002';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('GET /admin/roles', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Roles Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ar-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
    await db('roles').insert({ tenant_id: TENANT_ID, name: 'Reviewer' });
  });

  afterAll(async () => {
    await db('roles').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it("lists the tenant's roles", async () => {
    const response = await request(app).get('/admin/roles').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.some((r) => r.name === 'Reviewer')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/adminUsers.test.js tests/adminRoles.test.js`
Expected: FAIL — routes not found.

- [ ] **Step 3: Write `backend/src/services/userService.js`**

```js
const db = require('../config/db');

async function listUsers(tenantId) {
  return db('users').where({ tenant_id: tenantId }).select('id', 'email', 'full_name', 'is_admin').orderBy('email');
}

module.exports = { listUsers };
```

- [ ] **Step 4: Write `backend/src/services/roleService.js`**

```js
const db = require('../config/db');

async function listRoles(tenantId) {
  return db('roles').where({ tenant_id: tenantId }).select('id', 'name').orderBy('name');
}

module.exports = { listRoles };
```

- [ ] **Step 5: Write `backend/src/routes/admin/users.js`**

```js
const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { listUsers } = require('../../services/userService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const users = await listUsers(req.user.tenantId);
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 6: Write `backend/src/routes/admin/roles.js`**

```js
const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { listRoles } = require('../../services/roleService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const roles = await listRoles(req.user.tenantId);
    res.status(200).json(roles);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 7: Mount both routers in `backend/src/app.js`**

Add with the other route imports:
```js
const adminUsersRouter = require('./routes/admin/users');
const adminRolesRouter = require('./routes/admin/roles');
```
Add with the other `/admin/*` mounts:
```js
app.use('/admin/users', adminUsersRouter);
app.use('/admin/roles', adminRolesRouter);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx jest tests/adminUsers.test.js tests/adminRoles.test.js`
Expected: PASS, 3 tests green.

- [ ] **Step 9: Run the full backend suite to confirm nothing broke, then commit**

Run: `npm test`
Expected: all suites pass (the prior 103 tests + these 3 new ones = 106).

```bash
cd "d:\Project\Workflow Managment System"
git add backend/src/services/userService.js backend/src/services/roleService.js backend/src/routes/admin/users.js backend/src/routes/admin/roles.js backend/src/app.js backend/tests/adminUsers.test.js backend/tests/adminRoles.test.js
git commit -m "feat: add read-only admin users/roles list endpoints for the frontend stage picker"
```

---

## Task 2: Frontend API modules for template files, workflow templates, document types, users, roles

**Files:**
- Create: `frontend/src/api/templateFiles.ts`
- Create: `frontend/src/api/workflowTemplates.ts`
- Create: `frontend/src/api/documentTypes.ts`
- Create: `frontend/src/api/users.ts`
- Create: `frontend/src/api/roles.ts`

**Interfaces:** typed fetch functions for every admin endpoint used by Tasks 3-5, mirroring `api/auth.ts`'s style.

- [ ] **Step 1: Write `frontend/src/api/templateFiles.ts`**

```ts
import { apiFetch } from './client';

export interface TemplateFile {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateFileVersion {
  id: string;
  template_file_id: string;
  version_number: number;
  file_path: string;
  uploaded_by: string;
  created_at: string;
}

export interface TemplateFileDetail extends TemplateFile {
  versions: TemplateFileVersion[];
}

export function listTemplateFiles(): Promise<TemplateFile[]> {
  return apiFetch('/admin/template-files');
}

export function getTemplateFile(id: string): Promise<TemplateFileDetail> {
  return apiFetch(`/admin/template-files/${id}`);
}

export function createTemplateFile(name: string): Promise<TemplateFile> {
  return apiFetch('/admin/template-files', { method: 'POST', body: JSON.stringify({ name }) });
}

export function uploadTemplateFileVersion(id: string, file: File): Promise<TemplateFileVersion> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch(`/admin/template-files/${id}/versions`, { method: 'POST', body: formData });
}
```

- [ ] **Step 2: Write `frontend/src/api/workflowTemplates.ts`**

```ts
import { apiFetch } from './client';

export interface WorkflowTemplate {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStage {
  id: string;
  workflow_template_id: string;
  stage_order: number;
  name: string;
  assignee_type: 'user' | 'role';
  assignee_user_id: string | null;
  assignee_role_id: string | null;
  allowed_actions: string[];
  created_at: string;
}

export interface WorkflowTemplateDetail extends WorkflowTemplate {
  stages: WorkflowStage[];
}

export function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  return apiFetch('/admin/workflow-templates');
}

export function getWorkflowTemplate(id: string): Promise<WorkflowTemplateDetail> {
  return apiFetch(`/admin/workflow-templates/${id}`);
}

export function createWorkflowTemplate(name: string): Promise<WorkflowTemplate> {
  return apiFetch('/admin/workflow-templates', { method: 'POST', body: JSON.stringify({ name }) });
}

export interface AddStageInput {
  stageOrder: number;
  name: string;
  assigneeType: 'user' | 'role';
  assigneeUserId?: string;
  assigneeRoleId?: string;
  allowedActions: string[];
}

export function addWorkflowStage(workflowTemplateId: string, input: AddStageInput): Promise<WorkflowStage> {
  return apiFetch(`/admin/workflow-templates/${workflowTemplateId}/stages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 3: Write `frontend/src/api/documentTypes.ts`**

```ts
import { apiFetch } from './client';

export interface DocumentType {
  id: string;
  name: string;
  template_file_id: string;
  workflow_template_id: string;
  allowed_extensions: string[];
  max_upload_size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentTypeInput {
  name: string;
  templateFileId: string;
  workflowTemplateId: string;
  allowedExtensions?: string[];
  maxUploadSizeBytes?: number;
}

export function listDocumentTypes(): Promise<DocumentType[]> {
  return apiFetch('/admin/document-types');
}

export function createDocumentType(input: DocumentTypeInput): Promise<DocumentType> {
  return apiFetch('/admin/document-types', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDocumentType(id: string, input: Partial<DocumentTypeInput>): Promise<DocumentType> {
  return apiFetch(`/admin/document-types/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteDocumentType(id: string): Promise<void> {
  return apiFetch(`/admin/document-types/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: Write `frontend/src/api/users.ts`**

```ts
import { apiFetch } from './client';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
}

export function listUsers(): Promise<AdminUser[]> {
  return apiFetch('/admin/users');
}
```

- [ ] **Step 5: Write `frontend/src/api/roles.ts`**

```ts
import { apiFetch } from './client';

export interface AdminRole {
  id: string;
  name: string;
}

export function listRoles(): Promise<AdminRole[]> {
  return apiFetch('/admin/roles');
}
```

- [ ] **Step 6: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/api/templateFiles.ts frontend/src/api/workflowTemplates.ts frontend/src/api/documentTypes.ts frontend/src/api/users.ts frontend/src/api/roles.ts
git commit -m "feat: add frontend API modules for admin config resources"
```

---

## Task 3: Template files admin screens

**Files:**
- Modify: `frontend/src/pages/admin/TemplateFilesPage.tsx`
- Modify: `frontend/src/pages/admin/TemplateFileDetailPage.tsx`

**Interfaces:** consumes Task 2's `templateFiles.ts`. No new exports for later tasks.

- [ ] **Step 1: Rewrite `frontend/src/pages/admin/TemplateFilesPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTemplateFile, listTemplateFiles } from '../../api/templateFiles';
import { ApiError } from '../../api/client';

export function TemplateFilesPage() {
  const queryClient = useQueryClient();
  const { data: templateFiles, isLoading } = useQuery({ queryKey: ['templateFiles'], queryFn: listTemplateFiles });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createTemplateFile,
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['templateFiles'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create template file'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate(name);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Template Files</h1>

      <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          required
          placeholder="Template file name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {templateFiles?.map((templateFile) => (
          <li key={templateFile.id} className="px-4 py-3 text-sm">
            <Link to={`/admin/template-files/${templateFile.id}`} className="text-blue-700 hover:underline">
              {templateFile.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `frontend/src/pages/admin/TemplateFileDetailPage.tsx`**

```tsx
import { ChangeEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTemplateFile, uploadTemplateFileVersion } from '../../api/templateFiles';
import { ApiError } from '../../api/client';

export function TemplateFileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

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

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    uploadMutation.mutate(file);
    event.target.value = '';
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!templateFile) return <p className="text-sm text-red-700">Template file not found.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{templateFile.name}</h1>

      <label className="mb-6 block text-sm">
        <span className="mb-1 block font-medium">Upload new version</span>
        <input type="file" onChange={handleFileChange} disabled={uploadMutation.isPending} />
      </label>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

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
    </div>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/pages/admin/TemplateFilesPage.tsx frontend/src/pages/admin/TemplateFileDetailPage.tsx
git commit -m "feat: add template files admin screens"
```

---

## Task 4: Workflow templates admin screens (list, create, stage builder)

**Files:**
- Modify: `frontend/src/pages/admin/WorkflowTemplatesPage.tsx`
- Modify: `frontend/src/pages/admin/WorkflowTemplateDetailPage.tsx`

**Interfaces:** consumes Task 2's `workflowTemplates.ts`, `users.ts`, `roles.ts`.

- [ ] **Step 1: Rewrite `frontend/src/pages/admin/WorkflowTemplatesPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createWorkflowTemplate, listWorkflowTemplates } from '../../api/workflowTemplates';
import { ApiError } from '../../api/client';

export function WorkflowTemplatesPage() {
  const queryClient = useQueryClient();
  const { data: workflowTemplates, isLoading } = useQuery({
    queryKey: ['workflowTemplates'],
    queryFn: listWorkflowTemplates,
  });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createWorkflowTemplate,
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['workflowTemplates'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create workflow template'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate(name);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Workflow Templates</h1>

      <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          required
          placeholder="Workflow template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>
      {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {workflowTemplates?.map((workflowTemplate) => (
          <li key={workflowTemplate.id} className="px-4 py-3 text-sm">
            <Link to={`/admin/workflow-templates/${workflowTemplate.id}`} className="text-blue-700 hover:underline">
              {workflowTemplate.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `frontend/src/pages/admin/WorkflowTemplateDetailPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addWorkflowStage, getWorkflowTemplate } from '../../api/workflowTemplates';
import { listUsers } from '../../api/users';
import { listRoles } from '../../api/roles';
import { ApiError } from '../../api/client';

const ALL_ACTIONS = ['forward', 'send_back', 'reject'] as const;

export function WorkflowTemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: workflowTemplate, isLoading } = useQuery({
    queryKey: ['workflowTemplate', id],
    queryFn: () => getWorkflowTemplate(id!),
    enabled: Boolean(id),
  });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: listRoles });

  const [stageOrder, setStageOrder] = useState(1);
  const [stageName, setStageName] = useState('');
  const [assigneeType, setAssigneeType] = useState<'user' | 'role'>('user');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assigneeRoleId, setAssigneeRoleId] = useState('');
  const [allowedActions, setAllowedActions] = useState<string[]>([...ALL_ACTIONS]);
  const [error, setError] = useState<string | null>(null);

  const addStageMutation = useMutation({
    mutationFn: () =>
      addWorkflowStage(id!, {
        stageOrder,
        name: stageName,
        assigneeType,
        assigneeUserId: assigneeType === 'user' ? assigneeUserId : undefined,
        assigneeRoleId: assigneeType === 'role' ? assigneeRoleId : undefined,
        allowedActions,
      }),
    onSuccess: () => {
      setStageName('');
      setStageOrder((workflowTemplate?.stages.length ?? 0) + 2);
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate', id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to add stage'),
  });

  function toggleAction(action: string) {
    setAllowedActions((current) =>
      current.includes(action) ? current.filter((a) => a !== action) : [...current, action],
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    addStageMutation.mutate();
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!workflowTemplate) return <p className="text-sm text-red-700">Workflow template not found.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">{workflowTemplate.name}</h1>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Stages</h2>
      <ul className="mb-6 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {workflowTemplate.stages.map((stage) => (
          <li key={stage.id} className="px-4 py-3 text-sm">
            <span className="font-medium">
              {stage.stage_order}. {stage.name}
            </span>{' '}
            — {stage.assignee_type === 'user' ? 'assigned user' : 'assigned role'} — actions:{' '}
            {stage.allowed_actions.join(', ')}
          </li>
        ))}
        {workflowTemplate.stages.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500">No stages configured yet.</li>
        )}
      </ul>

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Add stage</h2>
      <form onSubmit={handleSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          Stage order
          <input
            type="number"
            min={1}
            required
            value={stageOrder}
            onChange={(e) => setStageOrder(Number(e.target.value))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Stage name
          <input
            type="text"
            required
            value={stageName}
            onChange={(e) => setStageName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={assigneeType === 'user'}
              onChange={() => setAssigneeType('user')}
            />
            Assign to user
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={assigneeType === 'role'}
              onChange={() => setAssigneeType('role')}
            />
            Assign to role
          </label>
        </div>
        {assigneeType === 'user' ? (
          <label className="block text-sm">
            User
            <select
              required
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a user</option>
              {users?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name ? `${user.full_name} (${user.email})` : user.email}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-sm">
            Role
            <select
              required
              value={assigneeRoleId}
              onChange={(e) => setAssigneeRoleId(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select a role</option>
              {roles?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Allowed actions</legend>
          {ALL_ACTIONS.map((action) => (
            <label key={action} className="mr-4 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={allowedActions.includes(action)}
                onChange={() => toggleAction(action)}
              />
              {action}
            </label>
          ))}
        </fieldset>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={addStageMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add stage
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/pages/admin/WorkflowTemplatesPage.tsx frontend/src/pages/admin/WorkflowTemplateDetailPage.tsx
git commit -m "feat: add workflow templates admin screens with stage builder"
```

---

## Task 5: Document types admin screen (CRUD)

**Files:**
- Modify: `frontend/src/pages/admin/DocumentTypesPage.tsx`

**Interfaces:** consumes Task 2's `documentTypes.ts`, `templateFiles.ts`, `workflowTemplates.ts`.

- [ ] **Step 1: Rewrite `frontend/src/pages/admin/DocumentTypesPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDocumentType,
  deleteDocumentType,
  listDocumentTypes,
  updateDocumentType,
} from '../../api/documentTypes';
import { listTemplateFiles } from '../../api/templateFiles';
import { listWorkflowTemplates } from '../../api/workflowTemplates';
import { ApiError } from '../../api/client';

export function DocumentTypesPage() {
  const queryClient = useQueryClient();
  const { data: documentTypes, isLoading } = useQuery({ queryKey: ['documentTypes'], queryFn: listDocumentTypes });
  const { data: templateFiles } = useQuery({ queryKey: ['templateFiles'], queryFn: listTemplateFiles });
  const { data: workflowTemplates } = useQuery({ queryKey: ['workflowTemplates'], queryFn: listWorkflowTemplates });

  const [name, setName] = useState('');
  const [templateFileId, setTemplateFileId] = useState('');
  const [workflowTemplateId, setWorkflowTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['documentTypes'] });
  }

  const createMutation = useMutation({
    mutationFn: createDocumentType,
    onSuccess: () => {
      setName('');
      setTemplateFileId('');
      setWorkflowTemplateId('');
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create document type'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name: newName }: { id: string; name: string }) => updateDocumentType(id, { name: newName }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to update document type'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDocumentType,
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to delete document type'),
  });

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    createMutation.mutate({ name, templateFileId, workflowTemplateId });
  }

  function startEditing(id: string, currentName: string) {
    setEditingId(id);
    setEditingName(currentName);
  }

  function saveEdit(id: string) {
    updateMutation.mutate({ id, name: editingName });
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Document Types</h1>

      <form onSubmit={handleCreate} className="mb-6 space-y-3 rounded border border-gray-200 bg-white p-4">
        <label className="block text-sm">
          Name
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Template file
          <select
            required
            value={templateFileId}
            onChange={(e) => setTemplateFileId(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">Select a template file</option>
            {templateFiles?.map((tf) => (
              <option key={tf.id} value={tf.id}>
                {tf.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Workflow template
          <select
            required
            value={workflowTemplateId}
            onChange={(e) => setWorkflowTemplateId(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">Select a workflow template</option>
            {workflowTemplates?.map((wt) => (
              <option key={wt.id} value={wt.id}>
                {wt.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
        {documentTypes?.map((documentType) => (
          <li key={documentType.id} className="flex items-center justify-between px-4 py-3 text-sm">
            {editingId === documentType.id ? (
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="mr-2 flex-1 rounded border border-gray-300 px-2 py-1"
              />
            ) : (
              <span>{documentType.name}</span>
            )}
            <span className="flex gap-3">
              {editingId === documentType.id ? (
                <button onClick={() => saveEdit(documentType.id)} className="text-blue-700 hover:underline">
                  Save
                </button>
              ) : (
                <button
                  onClick={() => startEditing(documentType.id, documentType.name)}
                  className="text-blue-700 hover:underline"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => deleteMutation.mutate(documentType.id)}
                className="text-red-700 hover:underline"
              >
                Delete
              </button>
            </span>
          </li>
        ))}
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
git add frontend/src/pages/admin/DocumentTypesPage.tsx
git commit -m "feat: add document types admin CRUD screen"
```

---

## Task 6: End-to-end verification

**Files:** none created — verification only, plus `PROGRESS.md`.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all 106 tests pass.

- [ ] **Step 2: Verify the frontend build one more time, clean**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds.

- [ ] **Step 3: Live-verify the new backend endpoints and confirm the admin screens' underlying requests are correct**

With both dev servers running:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@dev.local","password":"ChangeMe123!"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")
curl -s http://localhost:3000/admin/users -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/admin/roles -H "Authorization: Bearer $TOKEN"
```
Expected: both return arrays (the seeded dev admin, and an empty roles array unless one was created earlier in this session).

As in Frontend Phase 1, no browser-automation tool is available, so the actual click-through (creating a template file, uploading a version, building a workflow with the stage form, creating a document type) cannot be performed by the agent — report this honestly and recommend the user spot-check it.

- [ ] **Step 4: Update `PROGRESS.md` and commit**

```bash
cd "d:\Project\Workflow Managment System"
git add PROGRESS.md
git commit -m "docs: update progress log for Frontend Phase 2 completion"
```
