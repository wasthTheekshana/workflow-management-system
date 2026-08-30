# Rich-Text Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second template/instance content format — rich text, composed directly in the browser — living alongside the existing `.docx` format, using the same admin-creates-template → user-edits-instance → forwards pattern already in place.

**Architecture:** `template_files.content_format` (fixed at creation) decides which path a template — and every instance built from it — uses. `template_file_versions`/`instance_versions` each gain a nullable `content` column alongside the existing nullable `file_path`, with a DB-enforced "exactly one" constraint. New content-version endpoints parallel the existing file-upload ones; existing docx-only endpoints (upload, OnlyOffice edit-config) reject non-docx targets with a clear 400. Frontend: a `RichTextEditor` (TipTap) shown instead of the docx controls when a template/instance is `richtext`-formatted.

**Tech Stack:** Backend: no new dependencies (plain `jsonb` + existing Knex/AppError patterns). Frontend: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`.

**Spec:** `docs/superpowers/specs/2026-08-30-richtext-documents-design.md`

## Global Constraints

- `content_format` lives on `template_files` only, is set once at creation, and is never editable afterward. (Spec §2, §3)
- Every `template_file_versions`/`instance_versions` row has exactly one of `file_path` / `content` set — enforced by a `CHECK` constraint, not application code alone. (Spec §3)
- Every existing `docx` endpoint (upload, OnlyOffice edit-config) rejects a `richtext` target with a clear `AppError(400, ...)`, and every new `richtext` endpoint rejects a `docx` target the same way — never a silent no-op. (Spec §4.1, §4.2, §4.3)
- Saving in the rich-text editor is an explicit action (a **Save** button), never automatic — matching the existing upload flow's "save is a distinct action" pattern. (Spec §5)

---

## Task 1: Schema migration

**Files:**
- Create: `backend/migrations/011_add_content_format_and_richtext_content.js`

**Interfaces:**
- Produces: `template_files.content_format` (string, `NOT NULL DEFAULT 'docx'`, CHECK'd to `docx`/`richtext`); `template_file_versions.content` and `instance_versions.content` (nullable `jsonb`); `file_path` now nullable on both, each with an "exactly one of file_path/content" CHECK constraint. Every later task in this plan depends on this schema.

- [ ] **Step 1: Write `backend/migrations/011_add_content_format_and_richtext_content.js`**

```js
exports.up = async function up(knex) {
  await knex.schema.alterTable('template_files', (table) => {
    table.string('content_format').notNullable().defaultTo('docx');
  });
  await knex.raw(
    "ALTER TABLE template_files ADD CONSTRAINT template_files_content_format_check CHECK (content_format IN ('docx', 'richtext'))",
  );

  await knex.schema.alterTable('template_file_versions', (table) => {
    table.jsonb('content').nullable();
  });
  await knex.raw('ALTER TABLE template_file_versions ALTER COLUMN file_path DROP NOT NULL');
  await knex.raw(`
    ALTER TABLE template_file_versions
    ADD CONSTRAINT template_file_versions_exactly_one_payload
    CHECK ((file_path IS NOT NULL) <> (content IS NOT NULL))
  `);

  await knex.schema.alterTable('instance_versions', (table) => {
    table.jsonb('content').nullable();
  });
  await knex.raw('ALTER TABLE instance_versions ALTER COLUMN file_path DROP NOT NULL');
  await knex.raw(`
    ALTER TABLE instance_versions
    ADD CONSTRAINT instance_versions_exactly_one_payload
    CHECK ((file_path IS NOT NULL) <> (content IS NOT NULL))
  `);
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE instance_versions DROP CONSTRAINT IF EXISTS instance_versions_exactly_one_payload');
  await knex.raw('ALTER TABLE instance_versions ALTER COLUMN file_path SET NOT NULL');
  await knex.schema.alterTable('instance_versions', (table) => {
    table.dropColumn('content');
  });

  await knex.raw(
    'ALTER TABLE template_file_versions DROP CONSTRAINT IF EXISTS template_file_versions_exactly_one_payload',
  );
  await knex.raw('ALTER TABLE template_file_versions ALTER COLUMN file_path SET NOT NULL');
  await knex.schema.alterTable('template_file_versions', (table) => {
    table.dropColumn('content');
  });

  await knex.raw('ALTER TABLE template_files DROP CONSTRAINT IF EXISTS template_files_content_format_check');
  await knex.schema.alterTable('template_files', (table) => {
    table.dropColumn('content_format');
  });
};
```

- [ ] **Step 2: Run the migration against both databases and verify**

Run:
```bash
cd "d:\Project\Workflow Managment System\backend"
npx knex migrate:latest --env development
npx knex migrate:latest --env test
npx knex migrate:list --env development
```
Expected: migration 011 applies cleanly to both, no pending migrations afterward.

- [ ] **Step 3: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add backend/migrations/011_add_content_format_and_richtext_content.js
git commit -m "feat: add content_format and richtext content columns"
```

---

## Task 2: Backend — template file content-version endpoints

**Files:**
- Modify: `backend/src/services/templateFileService.js`
- Modify: `backend/src/routes/admin/templateFiles.js`
- Test: `backend/tests/templateFilesRichText.test.js`

**Interfaces:**
- Produces: `createTemplateFile(tenantId, name, contentFormat?)` (extended), `addTemplateFileContentVersion(tenantId, templateFileId, uploadedBy, content) -> Promise<version>`; `POST /admin/template-files` (extended body), `POST /admin/template-files/:id/content-versions`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/templateFilesRichText.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'af000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'af000000-0000-0000-0000-000000000002';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const sampleContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };

describe('rich-text template files', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'RichText Template Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'rt-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('creates a richtext template and saves content versions', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Template', contentFormat: 'richtext' });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.content_format).toBe('richtext');
    const templateFileId = createResponse.body.id;

    const versionResponse = await request(app)
      .post(`/admin/template-files/${templateFileId}/content-versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: sampleContent });
    expect(versionResponse.status).toBe(201);
    expect(versionResponse.body.version_number).toBe(1);
    expect(versionResponse.body.content).toEqual(sampleContent);

    const detailResponse = await request(app)
      .get(`/admin/template-files/${templateFileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.body.versions).toHaveLength(1);
    expect(detailResponse.body.versions[0].file_path).toBeNull();
  });

  it('rejects a file upload on a richtext template', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Template 2', contentFormat: 'richtext' });
    const templateFileId = createResponse.body.id;

    const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
    const response = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');
    expect(response.status).toBe(400);
  });

  it('rejects a content-version on a docx template', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Docx Template' });
    expect(createResponse.body.content_format).toBe('docx');
    const templateFileId = createResponse.body.id;

    const response = await request(app)
      .post(`/admin/template-files/${templateFileId}/content-versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: sampleContent });
    expect(response.status).toBe(400);
  });

  it('rejects Edit Online (OnlyOffice) on a richtext template', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Template 3', contentFormat: 'richtext' });
    const templateFileId = createResponse.body.id;
    await request(app)
      .post(`/admin/template-files/${templateFileId}/content-versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: sampleContent });

    const response = await request(app)
      .get(`/admin/template-files/${templateFileId}/edit-config`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/templateFilesRichText.test.js`
Expected: FAIL — `contentFormat` ignored, `content-versions` route not found.

- [ ] **Step 3: Update `backend/src/services/templateFileService.js`**

Add near the top, after the existing constants:
```js
const ALLOWED_CONTENT_FORMATS = ['docx', 'richtext'];
```

Replace `createTemplateFile`:
```js
async function createTemplateFile(tenantId, name, contentFormat) {
  assertRequiredString(name, 'name');
  const format = contentFormat || 'docx';
  if (!ALLOWED_CONTENT_FORMATS.includes(format)) {
    throw new AppError(400, `contentFormat must be one of: ${ALLOWED_CONTENT_FORMATS.join(', ')}`);
  }
  const [templateFile] = await db('template_files')
    .insert({ tenant_id: tenantId, name, content_format: format })
    .returning('*');
  return templateFile;
}
```

Add a format guard at the top of `addTemplateFileVersion`, right after the "not found" check:
```js
  if (templateFile.content_format !== 'docx') {
    throw new AppError(400, 'This template does not accept file uploads; it is a rich-text template');
  }
```

Add a new function, after `addTemplateFileVersion`:
```js
async function addTemplateFileContentVersion(tenantId, templateFileId, uploadedBy, content) {
  assertUuid(templateFileId, 'templateFileId');
  const templateFile = await db('template_files').where({ tenant_id: tenantId, id: templateFileId }).first();
  if (!templateFile) {
    throw new AppError(404, 'Template file not found');
  }
  if (templateFile.content_format !== 'richtext') {
    throw new AppError(400, 'This template is not a rich-text template');
  }
  if (typeof content !== 'object' || content === null) {
    throw new AppError(400, 'content must be a JSON object');
  }

  const latestVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, template_file_id: templateFileId })
    .max('version_number as max')
    .first();
  const nextVersionNumber = (latestVersion && latestVersion.max ? latestVersion.max : 0) + 1;

  const [version] = await db('template_file_versions')
    .insert({
      tenant_id: tenantId,
      template_file_id: templateFileId,
      version_number: nextVersionNumber,
      content: JSON.stringify(content),
      uploaded_by: uploadedBy,
    })
    .returning('*');

  return version;
}
```

Update `module.exports`:
```js
module.exports = {
  createTemplateFile,
  listTemplateFiles,
  getTemplateFile,
  addTemplateFileVersion,
  addTemplateFileContentVersion,
  saveTemplateFileVersionBuffer,
};
```

- [ ] **Step 4: Update `backend/src/routes/admin/templateFiles.js`**

Update the destructured import:
```js
const {
  createTemplateFile,
  listTemplateFiles,
  getTemplateFile,
  addTemplateFileVersion,
  addTemplateFileContentVersion,
} = require('../../services/templateFileService');
```

Update the create route:
```js
router.post('/', async (req, res, next) => {
  try {
    const templateFile = await createTemplateFile(req.user.tenantId, req.body.name, req.body.contentFormat);
    res.status(201).json(templateFile);
  } catch (err) {
    next(err);
  }
});
```

Add before `module.exports = router;`:
```js
router.post('/:id/content-versions', async (req, res, next) => {
  try {
    const version = await addTemplateFileContentVersion(
      req.user.tenantId,
      req.params.id,
      req.user.userId,
      req.body.content,
    );
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Add the OnlyOffice format guard in `backend/src/services/documentEditingService.js`**

In `buildTemplateEditConfig`, right after the "template file not found" check:
```js
  if (templateFile.content_format !== 'docx') {
    throw new AppError(400, 'This template is not a docx template; use the rich-text editor instead');
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/templateFilesRichText.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 7: Run the existing template files suite to confirm no regression, then commit**

Run: `npx jest tests/templateFiles.test.js tests/documentEditingService.test.js`
Expected: PASS, unchanged from before this task.

```bash
cd "d:\Project\Workflow Managment System"
git add backend/src/services/templateFileService.js backend/src/routes/admin/templateFiles.js backend/src/services/documentEditingService.js backend/tests/templateFilesRichText.test.js
git commit -m "feat: add rich-text content versions for template files"
```

---

## Task 3: Backend — instance content-version endpoints

**Files:**
- Modify: `backend/src/services/workflowInstanceService.js`
- Modify: `backend/src/routes/instances.js`
- Modify: `backend/src/services/documentEditingService.js`
- Test: `backend/tests/instancesRichText.test.js`

**Interfaces:**
- Produces: `getInstanceDetail` (extended — `documentType.content_format` now populated), `addInstanceContentVersion(tenantId, userId, instanceId, content) -> Promise<version>`, `getCurrentContent(tenantId, instanceId) -> Promise<content>`; `POST /instances/:id/content-versions`, `GET /instances/:id/current-content`; `GET /instances/:id` now includes `contentFormat`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/instancesRichText.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ag000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ag000000-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'ag000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const assigneeToken = signToken({ sub: ASSIGNEE_ID, tenant_id: TENANT_ID, is_admin: false });
const initialContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Template' }] }] };
const editedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited' }] }] };

describe('rich-text instances', () => {
  let instanceId;
  let documentTypeId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'RichText Instance Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'rti-admin@example.com', password_hash: 'x', is_admin: true },
        { id: ASSIGNEE_ID, tenant_id: TENANT_ID, email: 'rti-assignee@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Instance Template', contentFormat: 'richtext' });
    await request(app)
      .post(`/admin/template-files/${templateFile.body.id}/content-versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: initialContent });

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RichText Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ASSIGNEE_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'RichText Doc',
        templateFileId: templateFile.body.id,
        workflowTemplateId: workflowTemplate.body.id,
      });
    documentTypeId = documentType.body.id;

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ documentTypeId });
    instanceId = started.body.id;
  });

  afterAll(async () => {
    await db('instance_versions').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_instances').where({ tenant_id: TENANT_ID }).del();
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('reports contentFormat on the instance detail response', async () => {
    const response = await request(app).get(`/instances/${instanceId}`).set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.body.contentFormat).toBe('richtext');
  });

  it('falls back to the template snapshot content before any instance version exists', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/current-content`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.status).toBe(200);
    expect(response.body.content).toEqual(initialContent);
  });

  it('rejects a file upload on a richtext instance', async () => {
    const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
    const response = await request(app)
      .post(`/instances/${instanceId}/versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');
    expect(response.status).toBe(400);
  });

  it('rejects Edit Online (OnlyOffice) on a richtext instance', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/edit-config`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.status).toBe(400);
  });

  it('saves a content version and serves it as the current content', async () => {
    const saveResponse = await request(app)
      .post(`/instances/${instanceId}/content-versions`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ content: editedContent });
    expect(saveResponse.status).toBe(201);
    expect(saveResponse.body.version_number).toBe(1);

    const currentResponse = await request(app)
      .get(`/instances/${instanceId}/current-content`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(currentResponse.body.content).toEqual(editedContent);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/instancesRichText.test.js`
Expected: FAIL — `contentFormat` missing, content-version routes not found.

- [ ] **Step 3: Update `getInstanceDetail` in `backend/src/services/workflowInstanceService.js`**

Replace the function:
```js
async function getInstanceDetail(tenantId, instanceId) {
  assertUuid(instanceId, 'instanceId');
  const instance = await db('workflow_instances').where({ tenant_id: tenantId, id: instanceId }).first();
  if (!instance) {
    throw new AppError(404, 'Workflow instance not found');
  }

  const documentType = await db('document_types')
    .where({ tenant_id: tenantId, id: instance.document_type_id })
    .first();

  const templateFile = await db('template_files')
    .where({ tenant_id: tenantId, id: documentType.template_file_id })
    .first();
  documentType.content_format = templateFile.content_format;

  const stage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: documentType.workflow_template_id,
      stage_order: instance.current_stage_order,
    })
    .first();

  return { instance, documentType, stage };
}
```

- [ ] **Step 4: Add a format guard to `addInstanceVersion`**

Right after the `canAct` check, before `assertAllowedUpload`:
```js
  if (documentType.content_format !== 'docx') {
    throw new AppError(400, 'This instance does not accept file uploads; it is a rich-text document');
  }
```

- [ ] **Step 5: Add `addInstanceContentVersion` and `getCurrentContent`**

Add after `addInstanceVersion`:
```js
async function addInstanceContentVersion(tenantId, userId, instanceId, content) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances accept new versions');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }
  if (documentType.content_format !== 'richtext') {
    throw new AppError(400, 'This instance is not a rich-text document');
  }
  if (typeof content !== 'object' || content === null) {
    throw new AppError(400, 'content must be a JSON object');
  }

  const latestVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .max('version_number as max')
    .first();
  const nextVersionNumber = (latestVersion && latestVersion.max ? latestVersion.max : 0) + 1;

  const [version] = await db('instance_versions')
    .insert({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      version_number: nextVersionNumber,
      content: JSON.stringify(content),
      uploaded_by: userId,
    })
    .returning('*');

  return version;
}

async function getCurrentContent(tenantId, instanceId) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);

  const latestInstanceVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('version_number', 'desc')
    .first();

  if (latestInstanceVersion) {
    return latestInstanceVersion.content;
  }

  const templateVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, id: instance.template_file_version_id })
    .first();
  return templateVersion.content;
}
```

Update `module.exports`:
```js
module.exports = {
  getInstanceDetail,
  startInstance,
  claimInstance,
  addInstanceVersion,
  addInstanceContentVersion,
  saveInstanceVersionBuffer,
  getCurrentFileInfo,
  getCurrentFilePath,
  getCurrentContent,
  forwardInstance,
  sendBackInstance,
  rejectInstance,
  resubmitInstance,
  reassignInstance,
};
```

- [ ] **Step 6: Update `backend/src/routes/instances.js`**

Update the destructured import to add `addInstanceContentVersion` and `getCurrentContent`.

Update the `GET /:id` route:
```js
router.get('/:id', async (req, res, next) => {
  try {
    const { instance, stage, documentType } = await getInstanceDetail(req.user.tenantId, req.params.id);
    res.status(200).json({ ...instance, currentStage: stage, contentFormat: documentType.content_format });
  } catch (err) {
    next(err);
  }
});
```

Add before `module.exports = router;`:
```js
router.post('/:id/content-versions', async (req, res, next) => {
  try {
    const version = await addInstanceContentVersion(req.user.tenantId, req.user.userId, req.params.id, req.body.content);
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/current-content', async (req, res, next) => {
  try {
    const content = await getCurrentContent(req.user.tenantId, req.params.id);
    res.status(200).json({ content });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 7: Add the OnlyOffice format guard for instances in `backend/src/services/documentEditingService.js`**

In `buildInstanceEditConfig`, right after `getInstanceDetail` is called:
```js
  if (documentType.content_format !== 'docx') {
    throw new AppError(400, 'This instance is not a docx document; use the rich-text editor instead');
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest tests/instancesRichText.test.js`
Expected: PASS, all 5 tests green.

- [ ] **Step 9: Run the full backend suite to confirm no regression, then commit**

Run: `npm test`
Expected: all suites pass.

```bash
cd "d:\Project\Workflow Managment System"
git add backend/src/services/workflowInstanceService.js backend/src/routes/instances.js backend/src/services/documentEditingService.js backend/tests/instancesRichText.test.js
git commit -m "feat: add rich-text content versions for instances"
```

---

## Task 4: Frontend — API modules and the `RichTextEditor` component

**Files:**
- Modify: `frontend/package.json` (add TipTap dependencies)
- Modify: `frontend/src/api/templateFiles.ts`
- Modify: `frontend/src/api/instances.ts`
- Create: `frontend/src/components/RichTextEditor.tsx`

**Interfaces:**
- Produces: extended `TemplateFile`/`TemplateFileVersion`/`InstanceVersion`/`InstanceWithStage` types (all now carry format/content fields), `createTemplateFile(name, contentFormat?)`, `addTemplateFileContentVersion(id, content)`, `addInstanceContentVersion(id, content)`, `getCurrentContent(id)`; `<RichTextEditor initialContent={...} onSave={...} isSaving={...} />`. Tasks 5 and 6 consume all of these.

- [ ] **Step 1: Add TipTap dependencies to `frontend/package.json`**

Add to `dependencies`:
```json
    "@tiptap/pm": "^2.5.8",
    "@tiptap/react": "^2.5.8",
    "@tiptap/starter-kit": "^2.5.8",
```

Run:
```bash
cd "d:\Project\Workflow Managment System\frontend"
npm install
```

- [ ] **Step 2: Update `frontend/src/api/templateFiles.ts`**

Replace the `TemplateFile` and `TemplateFileVersion` interfaces:
```ts
export interface TemplateFile {
  id: string;
  name: string;
  content_format: 'docx' | 'richtext';
  created_at: string;
  updated_at: string;
}

export interface TemplateFileVersion {
  id: string;
  template_file_id: string;
  version_number: number;
  file_path: string | null;
  content: Record<string, unknown> | null;
  uploaded_by: string;
  created_at: string;
}
```

Replace `createTemplateFile`:
```ts
export function createTemplateFile(name: string, contentFormat: 'docx' | 'richtext' = 'docx'): Promise<TemplateFile> {
  return apiFetch('/admin/template-files', { method: 'POST', body: JSON.stringify({ name, contentFormat }) });
}
```

Add after `uploadTemplateFileVersion`:
```ts
export function addTemplateFileContentVersion(
  id: string,
  content: Record<string, unknown>,
): Promise<TemplateFileVersion> {
  return apiFetch(`/admin/template-files/${id}/content-versions`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}
```

- [ ] **Step 3: Update `frontend/src/api/instances.ts`**

Update `InstanceVersion` and `InstanceWithStage`:
```ts
export interface InstanceVersion {
  id: string;
  workflow_instance_id: string;
  version_number: number;
  file_path: string | null;
  content: Record<string, unknown> | null;
  uploaded_by: string;
  created_at: string;
}

export interface InstanceWithStage extends WorkflowInstance {
  currentStage: StageInfo;
  contentFormat: 'docx' | 'richtext';
}
```

Add after `getCurrentFilePath`... (i.e. after the last function in the file):
```ts
export function addInstanceContentVersion(id: string, content: Record<string, unknown>): Promise<InstanceVersion> {
  return apiFetch(`/instances/${id}/content-versions`, { method: 'POST', body: JSON.stringify({ content }) });
}

export function getCurrentContent(id: string): Promise<{ content: Record<string, unknown> | null }> {
  return apiFetch(`/instances/${id}/current-content`);
}
```

- [ ] **Step 4: Write `frontend/src/components/RichTextEditor.tsx`**

```tsx
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface RichTextEditorProps {
  initialContent: JSONContent | null;
  onSave: (content: JSONContent) => void;
  isSaving: boolean;
}

const HEADING_LEVELS = [1, 2, 3] as const;

export function RichTextEditor({ initialContent, onSave, isSaving }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent ?? '<p></p>',
  });

  if (!editor) {
    return <p className="text-sm text-gray-500">Loading editor...</p>;
  }

  function toolbarButtonClass(active: boolean) {
    return `rounded px-2 py-1 text-sm hover:bg-gray-100 ${active ? 'bg-gray-200' : ''}`;
  }

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-2">
        <button onClick={() => editor.chain().focus().undo().run()} className={toolbarButtonClass(false)}>
          Undo
        </button>
        <button onClick={() => editor.chain().focus().redo().run()} className={toolbarButtonClass(false)}>
          Redo
        </button>
        <span className="mx-1 h-5 w-px bg-gray-200" />
        {HEADING_LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
            className={toolbarButtonClass(editor.isActive('heading', { level }))}
          >
            H{level}
          </button>
        ))}
        <button
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={toolbarButtonClass(editor.isActive('paragraph'))}
        >
          Text
        </button>
        <span className="mx-1 h-5 w-px bg-gray-200" />
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`${toolbarButtonClass(editor.isActive('bold'))} font-bold`}
        >
          B
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`${toolbarButtonClass(editor.isActive('italic'))} italic`}
        >
          I
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`${toolbarButtonClass(editor.isActive('strike'))} line-through`}
        >
          S
        </button>
        <span className="mx-1 h-5 w-px bg-gray-200" />
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={toolbarButtonClass(editor.isActive('bulletList'))}
        >
          • List
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={toolbarButtonClass(editor.isActive('orderedList'))}
        >
          1. List
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onSave(editor.getJSON())}
          disabled={isSaving}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <div className="min-h-[300px] px-4 py-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/package.json frontend/package-lock.json frontend/src/api/templateFiles.ts frontend/src/api/instances.ts frontend/src/components/RichTextEditor.tsx
git commit -m "feat: add rich-text API functions and the RichTextEditor component"
```

---

## Task 5: Wire rich text into the admin template screens

**Files:**
- Modify: `frontend/src/pages/admin/TemplateFilesPage.tsx`
- Modify: `frontend/src/pages/admin/TemplateFileDetailPage.tsx`

**Interfaces:** consumes Task 4's extended `templateFiles.ts` and `<RichTextEditor>`.

- [ ] **Step 1: Add a format choice to `frontend/src/pages/admin/TemplateFilesPage.tsx`**

Add a `contentFormat` state (`useState<'docx' | 'richtext'>('docx')`), a radio-button pair next to the name input, and pass it to `createMutation.mutate`:

Replace the `useState` and mutation lines:
```tsx
const [name, setName] = useState('');
const [contentFormat, setContentFormat] = useState<'docx' | 'richtext'>('docx');
const [error, setError] = useState<string | null>(null);

const createMutation = useMutation({
  mutationFn: () => createTemplateFile(name, contentFormat),
  onSuccess: () => {
    setName('');
    queryClient.invalidateQueries({ queryKey: ['templateFiles'] });
  },
  onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create template file'),
});
```

Update `handleSubmit`:
```tsx
function handleSubmit(event: FormEvent) {
  event.preventDefault();
  setError(null);
  createMutation.mutate();
}
```

Add the format choice inside the `<form>`, before the submit button:
```tsx
<div className="flex gap-4 text-sm">
  <label className="flex items-center gap-1">
    <input type="radio" checked={contentFormat === 'docx'} onChange={() => setContentFormat('docx')} />
    Upload a Word document
  </label>
  <label className="flex items-center gap-1">
    <input type="radio" checked={contentFormat === 'richtext'} onChange={() => setContentFormat('richtext')} />
    Compose in the editor
  </label>
</div>
```

- [ ] **Step 2: Branch `frontend/src/pages/admin/TemplateFileDetailPage.tsx` on `content_format`**

Add to the imports:
```tsx
import { addTemplateFileContentVersion } from '../../api/templateFiles';
import { RichTextEditor } from '../../components/RichTextEditor';
```

Add a content-save mutation alongside the existing ones:
```tsx
const saveContentMutation = useMutation({
  mutationFn: (content: Record<string, unknown>) => addTemplateFileContentVersion(id!, content),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templateFile', id] }),
  onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save'),
});
```

Change the render body: after the `if (!templateFile) return ...` guard, branch before the existing `editorConfig ? ... : (...)` structure:
```tsx
if (templateFile.content_format === 'richtext') {
  const latestVersion = templateFile.versions[0]; // versions are ordered newest-first
  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">{templateFile.name}</h1>
      <RichTextEditor
        initialContent={latestVersion?.content ?? null}
        onSave={(content) => saveContentMutation.mutate(content)}
        isSaving={saveContentMutation.isPending}
      />
      {error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
```
(Leave the rest of the existing `docx`-path render — the `editorConfig ? <OnlineEditor /> : (...)` block — unchanged below this new branch.)

- [ ] **Step 3: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/pages/admin/TemplateFilesPage.tsx frontend/src/pages/admin/TemplateFileDetailPage.tsx
git commit -m "feat: wire rich-text editing into the admin template screens"
```

---

## Task 6: Wire rich text into the instance detail screen

**Files:**
- Modify: `frontend/src/pages/InstanceDetailPage.tsx`

**Interfaces:** consumes Task 4's extended `instances.ts` and `<RichTextEditor>`.

- [ ] **Step 1: Add the imports and content query/mutation**

Add to the imports:
```tsx
import { addInstanceContentVersion, getCurrentContent } from '../api/instances';
import { RichTextEditor } from '../components/RichTextEditor';
```

Add a query for the current content, alongside the existing `history` query (only enabled when relevant, to avoid a wasted call for `docx` instances):
```tsx
const { data: currentContent } = useQuery({
  queryKey: ['instanceContent', id],
  queryFn: () => getCurrentContent(id!),
  enabled: Boolean(id) && detail?.contentFormat === 'richtext',
});
```
(Place this after the `detail` query, since it depends on `detail.contentFormat`.)

Add a save mutation alongside the other mutations:
```tsx
const saveContentMutation = useMutation({
  mutationFn: (content: Record<string, unknown>) => addInstanceContentVersion(id!, content),
  onSuccess: invalidateAll,
  onError: (err) => onError(err, 'Failed to save'),
});
```

- [ ] **Step 2: Branch the render on `contentFormat`**

Replace the action-buttons/comment/history block's outer wrapper — after computing `isMine`/`canClaim`/`canResubmit`, add:
```tsx
if (detail.contentFormat === 'richtext') {
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-bold">{history?.documentType.name ?? 'Instance'}</h1>
      <p className="mb-6 text-sm text-gray-600">
        Stage: {currentStage.name} — status: {instance.status}
      </p>
      {error && <p className="mb-6 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {isMine ? (
        <RichTextEditor
          initialContent={currentContent?.content ?? null}
          onSave={(content) => saveContentMutation.mutate(content)}
          isSaving={saveContentMutation.isPending}
        />
      ) : (
        <p className="text-sm text-gray-500">You cannot edit this document right now.</p>
      )}
    </div>
  );
}
```
Place this `if` block right before the existing `return (` that renders the `docx` UI — so a `richtext` instance never reaches the OnlyOffice/upload JSX at all.

- [ ] **Step 3: Verify the build**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add frontend/src/pages/InstanceDetailPage.tsx
git commit -m "feat: wire rich-text editing into the instance detail page"
```

---

## Task 7: End-to-end verification

**Files:** none created — verification only, plus `PROGRESS.md`.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all suites pass (125 + this feature's new tests).

- [ ] **Step 2: Verify the frontend build one more time, clean**

Run: `cd "d:\Project\Workflow Managment System\frontend" && npm run build`
Expected: succeeds.

- [ ] **Step 3: Live-verify the full rich-text lifecycle via curl**

With the backend running:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@dev.local","password":"ChangeMe123!"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")

TEMPLATE_FILE_ID=$(curl -s -X POST http://localhost:3000/admin/template-files -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"RichText E2E Template","contentFormat":"richtext"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).id))")

curl -s -X POST http://localhost:3000/admin/template-files/$TEMPLATE_FILE_ID/content-versions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"E2E"}]}]}}'
```
Expected: `201` with `version_number: 1` and the content echoed back.

- [ ] **Step 4: Update `PROGRESS.md` and commit**

```bash
cd "d:\Project\Workflow Managment System"
git add PROGRESS.md
git commit -m "docs: update progress log for rich-text documents feature"
```
