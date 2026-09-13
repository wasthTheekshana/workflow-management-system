# Self-Service Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any authenticated user upload a `.docx` or compose a rich-text document and start an ad-hoc workflow from it in one step, with no admin-pre-created document type required.

**Architecture:** One new atomic endpoint creates a one-off `template_files` + `template_file_versions` row, a one-off `document_types` row, and (reusing the existing ad-hoc stage-builder unchanged) a one-off `workflow_templates` + stages, then the `workflow_instances` row — all in a single transaction. Every downstream instance operation (forward, claim, comments, document panel) needs zero changes since the result is an ordinary instance row.

**Tech Stack:** Node.js/Express/Knex/PostgreSQL backend, React/TypeScript/Vite frontend, Jest+Supertest backend tests, `tsc -b` for frontend verification (no frontend test framework in this repo).

**Spec:** `docs/superpowers/specs/2026-09-13-self-service-documents-design.md`

## Global Constraints

- The uploaded/composed document is one-off, scoped to a single instance — never a reusable template file other users can pick later (spec §1).
- `document_types.is_adhoc` and `template_files.is_adhoc` both default `false`; the admin `GET /admin/document-types` and `GET /admin/template-files` lists must exclude `is_adhoc: true` rows (spec §2).
- The existing public `GET /document-types` (used by "Start a Document"'s existing flow) is unaffected — untouched in this plan (spec §2).
- Ad-hoc stage assignee types stay `'user'`/`'group'` only, same as the existing ad-hoc flow (spec §5, matches prior Global Constraints).
- `createAdhocWorkflowTemplate` (in `backend/src/services/workflowInstanceService.js`) is reused unchanged — do not modify its signature or logic.
- Every backend change must keep the full existing test suite passing.

---

## Task 1: Migration — `is_adhoc` on `document_types` and `template_files`

**Files:**
- Create: `backend/migrations/018_add_is_adhoc_to_document_types_and_template_files.js`
- Modify: `backend/src/services/documentTypeService.js`
- Modify: `backend/src/services/templateFileService.js`
- Test: Create `backend/tests/selfServiceDocumentsSchema.test.js`

**Interfaces:**
- Produces: `document_types.is_adhoc` (boolean, not null, default `false`), `template_files.is_adhoc` (boolean, not null, default `false`). `documentTypeService.listDocumentTypes(tenantId)` and `templateFileService.listTemplateFiles(tenantId)` both exclude `is_adhoc: true` rows.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/selfServiceDocumentsSchema.test.js
const db = require('../src/config/db');

describe('self-service documents schema', () => {
  afterAll(async () => {
    await db.destroy();
  });

  it('adds is_adhoc to document_types and template_files, defaulting to false', async () => {
    expect(await db.schema.hasColumn('document_types', 'is_adhoc')).toBe(true);
    expect(await db.schema.hasColumn('template_files', 'is_adhoc')).toBe(true);

    const documentTypeColumns = await db('document_types').columnInfo();
    expect(documentTypeColumns.is_adhoc.nullable).toBe(false);

    const templateFileColumns = await db('template_files').columnInfo();
    expect(templateFileColumns.is_adhoc.nullable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/selfServiceDocumentsSchema.test.js`
Expected: FAIL — the columns don't exist yet.

- [ ] **Step 3: Write the migration**

```js
// backend/migrations/018_add_is_adhoc_to_document_types_and_template_files.js
exports.up = async function up(knex) {
  await knex.schema.alterTable('document_types', (table) => {
    table.boolean('is_adhoc').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('template_files', (table) => {
    table.boolean('is_adhoc').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('template_files', (table) => {
    table.dropColumn('is_adhoc');
  });
  await knex.schema.alterTable('document_types', (table) => {
    table.dropColumn('is_adhoc');
  });
};
```

- [ ] **Step 4: Run migrations and the test again to verify it passes**

Run: `cd backend && npx cross-env NODE_ENV=test npx knex migrate:latest && npx cross-env NODE_ENV=test npx jest tests/selfServiceDocumentsSchema.test.js`
Expected: PASS.

- [ ] **Step 5: Filter both admin list queries**

In `backend/src/services/documentTypeService.js`, change:

```js
async function listDocumentTypes(tenantId) {
  return db('document_types').where({ tenant_id: tenantId }).orderBy('created_at', 'desc');
}
```

to:

```js
async function listDocumentTypes(tenantId) {
  return db('document_types').where({ tenant_id: tenantId, is_adhoc: false }).orderBy('created_at', 'desc');
}
```

In `backend/src/services/templateFileService.js`, change:

```js
async function listTemplateFiles(tenantId) {
  return db('template_files').where({ tenant_id: tenantId }).orderBy('created_at', 'desc');
}
```

to:

```js
async function listTemplateFiles(tenantId) {
  return db('template_files').where({ tenant_id: tenantId, is_adhoc: false }).orderBy('created_at', 'desc');
}
```

- [ ] **Step 6: Run the full existing suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — all existing suites plus the new one (currently 47 suites / 192 tests before this task).

- [ ] **Step 7: Apply the migration to the dev database too**

Run: `cd backend && npx knex migrate:latest`

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/018_add_is_adhoc_to_document_types_and_template_files.js backend/src/services/documentTypeService.js backend/src/services/templateFileService.js backend/tests/selfServiceDocumentsSchema.test.js
git commit -m "feat: add is_adhoc flag to document_types and template_files

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Backend — `startInstanceFromOwnDocument` and the `/instances/from-document` route

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js`
- Modify: `backend/src/routes/instances.js`
- Test: Create `backend/tests/instances.fromDocument.test.js`

**Interfaces:**
- Consumes: `is_adhoc` columns (Task 1); `createAdhocWorkflowTemplate(trx, tenantId, userId, isAdmin, documentTypeLike, stages)` (existing, unchanged — only needs `documentTypeLike.name`); `saveUploadedFile(tenantId, buffer, extension)` and `assertAllowedUpload(file, allowedExtensions, maxSizeBytes)` (existing, already imported in this file); `notifyStage(tenantId, workflowInstanceId, templateName, stage, context)` (existing).
- Produces: `workflowInstanceService.startInstanceFromOwnDocument(tenantId, userId, isAdmin, { name, contentFormat, file, content, stages })` → `Promise<WorkflowInstance row>`. Route `POST /instances/from-document` (multipart/form-data: `name`, `contentFormat`, `file`?, `content`? (JSON string), `stages` (JSON string)) → 201 with the created instance.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/instances.fromDocument.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'f1000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'f1000000-0000-0000-0000-000000000002';
const CREATOR_ID = 'f1000000-0000-0000-0000-000000000003';
const REVIEWER_ID = 'f1000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const creatorToken = signToken({ sub: CREATOR_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('start an instance from a self-uploaded document', () => {
  let groupId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'From Document Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'fd-admin@example.com', password_hash: 'x', is_admin: true },
        { id: CREATOR_ID, tenant_id: TENANT_ID, email: 'fd-creator@example.com', password_hash: 'x' },
        { id: REVIEWER_ID, tenant_id: TENANT_ID, email: 'fd-reviewer@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const group = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'From Document Group' });
    groupId = group.body.id;
    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: CREATOR_ID });
    await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: REVIEWER_ID });
  });

  afterAll(async () => {
    await db('stage_actions').where({ tenant_id: TENANT_ID }).del();
    await db('instance_versions').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('starts an instance from an uploaded docx with a stage list', async () => {
    const stages = JSON.stringify([{ name: 'Review', assigneeType: 'user', assigneeId: REVIEWER_ID }]);
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'My Own Memo')
      .field('contentFormat', 'docx')
      .field('stages', stages)
      .attach('file', validDocxBuffer, 'memo.docx');
    expect(response.status).toBe(201);
    const instanceId = response.body.id;

    const detail = await request(app)
      .get(`/instances/${instanceId}`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(detail.body.contentFormat).toBe('docx');
    expect(detail.body.currentStage.name).toBe('Review');
    expect(detail.body.currentStage.assignee_user_id).toBe(REVIEWER_ID);

    const download = await request(app)
      .get(`/instances/${instanceId}/current-file`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(download.status).toBe(200);
  });

  it('starts an instance from composed rich text with a stage list', async () => {
    const stages = JSON.stringify([{ name: 'Review', assigneeType: 'group', assigneeId: groupId }]);
    const content = JSON.stringify({ type: 'doc', content: [] });
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'My Rich Text Memo')
      .field('contentFormat', 'richtext')
      .field('stages', stages)
      .field('content', content);
    expect(response.status).toBe(201);
    const instanceId = response.body.id;

    const currentContent = await request(app)
      .get(`/instances/${instanceId}/current-content`)
      .set('Authorization', `Bearer ${creatorToken}`);
    expect(currentContent.status).toBe(200);
    expect(currentContent.body.content).toEqual({ type: 'doc', content: [] });
  });

  it('rejects contentFormat "docx" with no file', async () => {
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'No File')
      .field('contentFormat', 'docx')
      .field('stages', JSON.stringify([{ name: 'Review', assigneeType: 'user', assigneeId: REVIEWER_ID }]));
    expect(response.status).toBe(400);
  });

  it('rejects contentFormat "richtext" with no content', async () => {
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'No Content')
      .field('contentFormat', 'richtext')
      .field('stages', JSON.stringify([{ name: 'Review', assigneeType: 'user', assigneeId: REVIEWER_ID }]));
    expect(response.status).toBe(400);
  });

  it('rejects a missing stages array', async () => {
    const response = await request(app)
      .post('/instances/from-document')
      .set('Authorization', `Bearer ${creatorToken}`)
      .field('name', 'No Stages')
      .field('contentFormat', 'richtext')
      .field('content', JSON.stringify({ type: 'doc', content: [] }));
    expect(response.status).toBe(400);
  });

  it('excludes the self-service document type and template file from admin lists', async () => {
    const documentTypes = await request(app)
      .get('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(documentTypes.body.some((dt) => dt.name === 'My Own Memo')).toBe(false);

    const templateFiles = await request(app)
      .get('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(templateFiles.body.some((tf) => tf.name === 'My Own Memo')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/instances.fromDocument.test.js`
Expected: FAIL — `POST /instances/from-document` doesn't exist yet (404s).

- [ ] **Step 3: Implement `startInstanceFromOwnDocument` in `workflowInstanceService.js`**

Add this constant near the top of the file, alongside the existing `ADHOC_ASSIGNEE_TYPES`/`ADHOC_DEFAULT_ALLOWED_ACTIONS`:

```js
const OWN_DOCUMENT_CONTENT_FORMATS = ['docx', 'richtext'];
const OWN_DOCUMENT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
```

Add this function (it can go anywhere after `createAdhocWorkflowTemplate`, since it calls it — a sensible spot is right after `startInstance`):

```js
async function startInstanceFromOwnDocument(tenantId, userId, isAdmin, { name, contentFormat, file, content, stages }) {
  assertRequiredString(name, 'name');
  if (!OWN_DOCUMENT_CONTENT_FORMATS.includes(contentFormat)) {
    throw new AppError(400, `contentFormat must be one of: ${OWN_DOCUMENT_CONTENT_FORMATS.join(', ')}`);
  }

  if (contentFormat === 'docx') {
    if (!file) {
      throw new AppError(400, 'file is required when contentFormat is "docx"');
    }
    assertAllowedUpload(file, ['docx'], OWN_DOCUMENT_MAX_UPLOAD_BYTES);
  } else if (typeof content !== 'object' || content === null) {
    throw new AppError(400, 'content must be a JSON object when contentFormat is "richtext"');
  }

  const { instance, firstStage } = await db.transaction(async (trx) => {
    const [templateFile] = await trx('template_files')
      .insert({ tenant_id: tenantId, name, content_format: contentFormat, is_adhoc: true })
      .returning('*');

    const versionFields =
      contentFormat === 'docx'
        ? { file_path: await saveUploadedFile(tenantId, file.buffer, file.originalname.split('.').pop().toLowerCase()) }
        : { content: JSON.stringify(content) };

    const [templateFileVersion] = await trx('template_file_versions')
      .insert({
        tenant_id: tenantId,
        template_file_id: templateFile.id,
        version_number: 1,
        uploaded_by: userId,
        ...versionFields,
      })
      .returning('*');

    const [documentType] = await trx('document_types')
      .insert({
        tenant_id: tenantId,
        name,
        template_file_id: templateFile.id,
        workflow_mode: 'adhoc',
        workflow_template_id: null,
        is_adhoc: true,
        allowed_extensions: JSON.stringify(['docx']),
        max_upload_size_bytes: OWN_DOCUMENT_MAX_UPLOAD_BYTES,
      })
      .returning('*');

    const workflowTemplateId = await createAdhocWorkflowTemplate(trx, tenantId, userId, isAdmin, { name }, stages);

    const stage = await trx('workflow_stages')
      .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId, stage_order: 1 })
      .first();

    const [insertedInstance] = await trx('workflow_instances')
      .insert({
        tenant_id: tenantId,
        document_type_id: documentType.id,
        template_file_version_id: templateFileVersion.id,
        workflow_template_id: workflowTemplateId,
        current_stage_order: 1,
        status: 'in_progress',
        created_by: userId,
      })
      .returning('*');

    return { instance: insertedInstance, firstStage: stage };
  });

  await notifyStage(tenantId, instance.id, 'assigned', firstStage, {
    documentTypeName: name,
    stageName: firstStage.name,
  });

  return instance;
}
```

Add `startInstanceFromOwnDocument` to the file's final `module.exports` object, alongside the existing exports.

- [ ] **Step 4: Wire the route in `backend/src/routes/instances.js`**

Add `startInstanceFromOwnDocument` to the existing `require('../services/workflowInstanceService')` destructure at the top of the file.

Add this route (placement: anywhere after `router.post('/', ...)`, e.g. immediately below it — `/from-document` is a distinct literal path so ordering relative to `/:id`-pattern routes doesn't matter, but keeping it near the other `POST /instances`-level route keeps related things together):

```js
router.post('/from-document', upload.single('file'), async (req, res, next) => {
  let stages;
  try {
    stages = req.body.stages ? JSON.parse(req.body.stages) : undefined;
  } catch {
    return res.status(400).json({ error: 'stages must be valid JSON' });
  }
  let content;
  try {
    content = req.body.content ? JSON.parse(req.body.content) : undefined;
  } catch {
    return res.status(400).json({ error: 'content must be valid JSON' });
  }

  try {
    const instance = await startInstanceFromOwnDocument(req.user.tenantId, req.user.userId, req.user.isAdmin, {
      name: req.body.name,
      contentFormat: req.body.contentFormat,
      file: req.file,
      content,
      stages,
    });
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});
```

(`upload` is already imported at the top of this file for the existing `/:id/versions` route.)

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/instances.fromDocument.test.js`
Expected: PASS — all 6 `it` blocks.

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — every existing suite plus this new one (should be 49 suites / 199 tests, up from 48/193 after Task 1).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/workflowInstanceService.js backend/src/routes/instances.js backend/tests/instances.fromDocument.test.js
git commit -m "feat: let a user start an ad-hoc workflow from their own uploaded or composed document

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Frontend API layer and `RichTextEditor` live-content callback

**Files:**
- Modify: `frontend/src/components/RichTextEditor.tsx`
- Modify: `frontend/src/api/instances.ts`

**Interfaces:**
- Consumes: `POST /instances/from-document` (Task 2); `apiFetch` (existing, already special-cases a `FormData` body — see `uploadInstanceVersion` in the same file for the pattern).
- Produces: `RichTextEditor`'s new optional `onChange?: (content: unknown) => void` prop (backward compatible — every existing caller omits it and is unaffected). `startInstanceFromOwnDocument(input: { name: string; contentFormat: 'docx' | 'richtext'; file?: File; content?: unknown; stages: AdhocStageInput[] }): Promise<WorkflowInstance>`, consumed by Task 4.

- [ ] **Step 1: Add `onChange` to `RichTextEditor`**

In `frontend/src/components/RichTextEditor.tsx`, add `onChange` to the props interface and wire it through Tiptap's `onUpdate`:

```tsx
interface RichTextEditorProps {
  title: string;
  initialContent: unknown;
  editable: boolean;
  saving?: boolean;
  onSave?: (content: unknown) => void;
  onChange?: (content: unknown) => void;
}

export function RichTextEditor({ title, initialContent, editable, saving, onSave, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: (initialContent as object) ?? '',
    editable,
    onUpdate: ({ editor: updatedEditor }) => {
      onChange?.(updatedEditor.getJSON());
    },
  });
```

(Read the current file first — this only adds the `onChange` prop and the `onUpdate` option to the existing `useEditor` call; every other line of the component, including the `useEffect` that syncs `editable` and the render output, stays exactly as it is.)

- [ ] **Step 2: Add `startInstanceFromOwnDocument` to `frontend/src/api/instances.ts`**

```ts
export function startInstanceFromOwnDocument(input: {
  name: string;
  contentFormat: 'docx' | 'richtext';
  file?: File;
  content?: unknown;
  stages: AdhocStageInput[];
}): Promise<WorkflowInstance> {
  const formData = new FormData();
  formData.append('name', input.name);
  formData.append('contentFormat', input.contentFormat);
  if (input.file) {
    formData.append('file', input.file);
  }
  if (input.content !== undefined) {
    formData.append('content', JSON.stringify(input.content));
  }
  formData.append('stages', JSON.stringify(input.stages));
  return apiFetch('/instances/from-document', { method: 'POST', body: formData });
}
```

(Add this export anywhere in the file after `AdhocStageInput` is defined, e.g. right after the existing `startInstance` export.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no output (clean compile).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RichTextEditor.tsx frontend/src/api/instances.ts
git commit -m "feat: add frontend API and editor support for self-service documents

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Frontend UI — self-service mode on "Start a Document"

**Files:**
- Create: `frontend/src/components/StageBuilder.tsx`
- Modify: `frontend/src/pages/NewInstancePage.tsx`

**Interfaces:**
- Consumes: `startInstanceFromOwnDocument`, `RichTextEditor`'s `onChange` (Task 3); `listVisibleUsers`/`listVisibleGroups` (existing); `AdhocStageInput` (existing, from `frontend/src/api/instances.ts`).
- Produces: `StageBuilder` — a shared component rendering the add/remove stage-row UI, extracted so both the existing ad-hoc branch and the new self-service mode use the identical block instead of duplicating it. Props: `{ stageRows: StageRow[]; visibleUsers?: VisibleUser[]; visibleGroups?: VisibleGroup[]; onUpdateRow: (index: number, patch: Partial<StageRow>) => void; onAddRow: () => void; onRemoveRow: (index: number) => void }` where `StageRow` is `{ name: string; assigneeType: 'user' | 'group'; assigneeId: string }` (moved into `StageBuilder.tsx` and exported from there, replacing the copy currently defined inline in `NewInstancePage.tsx`).

- [ ] **Step 1: Read the current file**

Read `frontend/src/pages/NewInstancePage.tsx` in full before editing — you'll be extracting its existing `StageRow` interface, `emptyRow` helper, and the JSX block from `{isAdhoc && ( ... )}` (the "Build the approval steps" section) into the new `StageBuilder.tsx`, then having both the existing ad-hoc mode and the new self-service mode call it.

- [ ] **Step 2: Create `frontend/src/components/StageBuilder.tsx`**

```tsx
import { VisibleUser } from '../api/users';
import { VisibleGroup } from '../api/groups';

export interface StageRow {
  name: string;
  assigneeType: 'user' | 'group';
  assigneeId: string;
}

export function emptyStageRow(): StageRow {
  return { name: '', assigneeType: 'user', assigneeId: '' };
}

interface StageBuilderProps {
  stageRows: StageRow[];
  visibleUsers?: VisibleUser[];
  visibleGroups?: VisibleGroup[];
  onUpdateRow: (index: number, patch: Partial<StageRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
}

export function StageBuilder({
  stageRows,
  visibleUsers,
  visibleGroups,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
}: StageBuilderProps) {
  return (
    <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
      <p className="text-sm font-medium text-gray-700">Build the approval steps</p>
      {stageRows.map((row, index) => (
        <div key={index} className="space-y-2 rounded border border-gray-200 bg-white p-2">
          <label className="block text-xs">
            Stage {index + 1} name
            <input
              type="text"
              required
              value={row.name}
              onChange={(e) => onUpdateRow(index, { name: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`stage-${index}-assignee-type`}
                checked={row.assigneeType === 'user'}
                onChange={() => onUpdateRow(index, { assigneeType: 'user', assigneeId: '' })}
              />
              Person
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`stage-${index}-assignee-type`}
                checked={row.assigneeType === 'group'}
                onChange={() => onUpdateRow(index, { assigneeType: 'group', assigneeId: '' })}
              />
              Group
            </label>
          </div>
          <select
            required
            value={row.assigneeId}
            onChange={(e) => onUpdateRow(index, { assigneeId: e.target.value })}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">{row.assigneeType === 'user' ? 'Select a person' : 'Select a group'}</option>
            {row.assigneeType === 'user'
              ? visibleUsers?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email}
                  </option>
                ))
              : visibleGroups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
          </select>
          {stageRows.length > 1 && (
            <button
              type="button"
              onClick={() => onRemoveRow(index)}
              className="text-xs text-red-700 hover:underline"
            >
              Remove stage
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={onAddRow} className="text-sm text-blue-700 hover:underline">
        + Add stage
      </button>
    </div>
  );
}
```

(Note the `name={`stage-${index}-assignee-type`}` on the radios — this fixes a pre-existing accessibility gap in the code you're extracting from, where the radios had no shared `name` and so weren't a proper native radio group. Include it; it costs nothing extra here.)

- [ ] **Step 3: Rewrite `frontend/src/pages/NewInstancePage.tsx`**

Replace the full file contents:

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AdhocStageInput,
  listStartableDocumentTypes,
  startInstance,
  startInstanceFromOwnDocument,
} from '../api/instances';
import { listVisibleUsers } from '../api/users';
import { listVisibleGroups } from '../api/groups';
import { ApiError } from '../api/client';
import { emptyStageRow, StageBuilder, StageRow } from '../components/StageBuilder';
import { RichTextEditor } from '../components/RichTextEditor';

type StartMode = 'existing' | 'own-document';

export function NewInstancePage() {
  const navigate = useNavigate();
  const { data: documentTypes, isLoading } = useQuery({
    queryKey: ['startableDocumentTypes'],
    queryFn: listStartableDocumentTypes,
  });
  const { data: visibleUsers } = useQuery({ queryKey: ['visibleUsers'], queryFn: listVisibleUsers });
  const { data: visibleGroups } = useQuery({ queryKey: ['visibleGroups'], queryFn: listVisibleGroups });

  const [mode, setMode] = useState<StartMode>('existing');
  const [error, setError] = useState<string | null>(null);

  // "Use an existing document type" mode
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [stageRows, setStageRows] = useState<StageRow[]>([emptyStageRow()]);

  // "Start from my own document" mode
  const [ownName, setOwnName] = useState('');
  const [ownContentFormat, setOwnContentFormat] = useState<'docx' | 'richtext'>('docx');
  const [ownFile, setOwnFile] = useState<File | null>(null);
  const [ownContent, setOwnContent] = useState<unknown>({});
  const [ownStageRows, setOwnStageRows] = useState<StageRow[]>([emptyStageRow()]);

  const selectedDocumentType = documentTypes?.find((dt) => dt.id === documentTypeId);
  const isAdhoc = selectedDocumentType?.workflow_mode === 'adhoc';

  const startMutation = useMutation({
    mutationFn: () => {
      const stages: AdhocStageInput[] | undefined = isAdhoc
        ? stageRows.map((row) => ({ name: row.name, assigneeType: row.assigneeType, assigneeId: row.assigneeId }))
        : undefined;
      return startInstance(documentTypeId, stages);
    },
    onSuccess: (instance) => navigate(`/instances/${instance.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to start document'),
  });

  const startFromOwnDocumentMutation = useMutation({
    mutationFn: () =>
      startInstanceFromOwnDocument({
        name: ownName,
        contentFormat: ownContentFormat,
        file: ownContentFormat === 'docx' ? ownFile ?? undefined : undefined,
        content: ownContentFormat === 'richtext' ? ownContent : undefined,
        stages: ownStageRows.map((row) => ({
          name: row.name,
          assigneeType: row.assigneeType,
          assigneeId: row.assigneeId,
        })),
      }),
    onSuccess: (instance) => navigate(`/instances/${instance.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to start document'),
  });

  function handleExistingSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startMutation.mutate();
  }

  function handleOwnDocumentSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startFromOwnDocumentMutation.mutate();
  }

  function updateRow(rows: StageRow[], setRows: (rows: StageRow[]) => void, index: number, patch: Partial<StageRow>) {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const canSubmitExisting =
    Boolean(documentTypeId) &&
    (!isAdhoc || stageRows.every((row) => row.name.trim().length > 0 && row.assigneeId.length > 0));

  const canSubmitOwnDocument =
    ownName.trim().length > 0 &&
    (ownContentFormat === 'docx' ? Boolean(ownFile) : true) &&
    ownStageRows.every((row) => row.name.trim().length > 0 && row.assigneeId.length > 0);

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Start a Document</h1>

      <div className="mb-4 flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" name="startMode" checked={mode === 'existing'} onChange={() => setMode('existing')} />
          Use an existing document type
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="startMode"
            checked={mode === 'own-document'}
            onChange={() => setMode('own-document')}
          />
          Start from my own document
        </label>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {mode === 'existing' && (
        <>
          {isLoading && <p className="text-sm text-gray-500">Loading document types...</p>}
          <form onSubmit={handleExistingSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
            <label className="block text-sm">
              Document type
              <select
                required
                value={documentTypeId}
                onChange={(e) => {
                  setDocumentTypeId(e.target.value);
                  setStageRows([emptyStageRow()]);
                }}
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

            {isAdhoc && (
              <StageBuilder
                stageRows={stageRows}
                visibleUsers={visibleUsers}
                visibleGroups={visibleGroups}
                onUpdateRow={(index, patch) => updateRow(stageRows, setStageRows, index, patch)}
                onAddRow={() => setStageRows([...stageRows, emptyStageRow()])}
                onRemoveRow={(index) =>
                  setStageRows(stageRows.length > 1 ? stageRows.filter((_, i) => i !== index) : stageRows)
                }
              />
            )}

            <button
              type="submit"
              disabled={startMutation.isPending || !canSubmitExisting}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Start
            </button>
          </form>
        </>
      )}

      {mode === 'own-document' && (
        <form onSubmit={handleOwnDocumentSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
          <label className="block text-sm">
            Document title
            <input
              type="text"
              required
              value={ownName}
              onChange={(e) => setOwnName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="ownContentFormat"
                checked={ownContentFormat === 'docx'}
                onChange={() => setOwnContentFormat('docx')}
              />
              Upload a Word document
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="ownContentFormat"
                checked={ownContentFormat === 'richtext'}
                onChange={() => setOwnContentFormat('richtext')}
              />
              Write rich text
            </label>
          </div>

          {ownContentFormat === 'docx' ? (
            <label className="block text-sm">
              File
              <input
                type="file"
                required
                accept=".docx"
                onChange={(e) => setOwnFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full text-sm"
              />
            </label>
          ) : (
            <div style={{ minHeight: '30vh' }}>
              <RichTextEditor
                title={ownName || 'New document'}
                initialContent={ownContent}
                editable
                onChange={setOwnContent}
              />
            </div>
          )}

          <StageBuilder
            stageRows={ownStageRows}
            visibleUsers={visibleUsers}
            visibleGroups={visibleGroups}
            onUpdateRow={(index, patch) => updateRow(ownStageRows, setOwnStageRows, index, patch)}
            onAddRow={() => setOwnStageRows([...ownStageRows, emptyStageRow()])}
            onRemoveRow={(index) =>
              setOwnStageRows(ownStageRows.length > 1 ? ownStageRows.filter((_, i) => i !== index) : ownStageRows)
            }
          />

          <button
            type="submit"
            disabled={startFromOwnDocumentMutation.isPending || !canSubmitOwnDocument}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Start
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no output (clean compile).

- [ ] **Step 5: Manual verification**

With both dev servers running: on "Start a Document", switch to "Start from my own document," fill a title, upload a small `.docx`, add 2 stages (one person, one group), submit, and confirm you land on the new instance's detail page with a working document panel. Repeat choosing "Write rich text" instead, typing something in the inline editor before submitting, and confirm the composed content shows up on the instance's document panel afterward. Then confirm the existing "Use an existing document type" mode (including its ad-hoc sub-flow) still behaves exactly as before — this is the regression risk from extracting `StageBuilder`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StageBuilder.tsx frontend/src/pages/NewInstancePage.tsx
git commit -m "feat: let a user start a workflow from their own document in the UI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
