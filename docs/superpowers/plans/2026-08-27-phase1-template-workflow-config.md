# Phase 1 — Template & Workflow Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a tenant admin everything needed to fully configure a 3-stage document workflow via API calls alone: upload/version master template files, build a workflow template with ordered stages (user- or role-assigned), and CRUD document types that link a template to a workflow.

**Architecture:** Admin-only routes under `/admin/*`, each protected by `authenticate` + a new `requireAdmin` middleware. Business rules live in `src/services/*Service.js` (never in route handlers), all DB access via Knex, all cross-references validated against the caller's own `tenant_id`. File uploads go through `multer` (memory storage) into a validation step (extension allow-list + size cap + magic-byte signature check) before being written to local disk via a small storage service.

**Tech Stack:** Same as Phase 0, plus `multer` for multipart file uploads.

**Spec:** `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`

## Global Constraints

- Every admin route requires both a valid JWT (`authenticate`) and `req.user.isAdmin === true` (`requireAdmin`) — 401 if unauthenticated, 403 if not admin. (Spec §6)
- Every query is scoped by `req.user.tenantId` from the verified JWT — never a tenant_id from the request body or params. (Spec §6)
- Every cross-table reference supplied in a request body (a template file ID, workflow template ID, user ID, role ID) is validated as UUID-shaped AND confirmed to belong to the caller's tenant before use — required-field and UUID-format checks per Spec §6/§6.2.
- Uploads are validated server-side: extension allow-list, size cap, and a file-signature (magic-byte) check — no upload is trusted on extension alone. (Spec §4 "Upload validation", §6)
- All error responses use the existing `{ error: string }` shape via `AppError` + the central `errorHandler` — no raw DB errors or stack traces reach the client. (Spec §6, §7)
- Template files are versioned and immutable — uploading a new version never overwrites a prior one; `version_number` increments per template file. (Spec §5.1, §4 "Template immutability")

---

## Task 1: `requireAdmin` middleware and shared validation utilities

**Files:**
- Create: `backend/src/middleware/requireAdmin.js`
- Create: `backend/src/utils/validation.js`
- Test: `backend/tests/requireAdmin.test.js`
- Test: `backend/tests/validation.test.js`

**Interfaces:**
- Consumes: `AppError` (Phase 0, `src/utils/AppError.js`), `req.user` as set by Phase 0's `authenticate` middleware.
- Produces: `requireAdmin(req, res, next)` (Express middleware), `isUuid(value) -> boolean`, `assertUuid(value, fieldName)` (throws `AppError(400, ...)`), `assertRequiredString(value, fieldName)` (throws `AppError(400, ...)`). Every task below imports `requireAdmin`, `assertUuid`, and `assertRequiredString` by these exact names.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/requireAdmin.test.js
const express = require('express');
const request = require('supertest');
const { authenticate } = require('../src/middleware/auth');
const { requireAdmin } = require('../src/middleware/requireAdmin');
const errorHandler = require('../src/middleware/errorHandler');
const { signToken } = require('../src/utils/jwt');

function buildTestApp() {
  const app = express();
  app.get('/admin-only', authenticate, requireAdmin, (req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('requireAdmin middleware', () => {
  const app = buildTestApp();

  it('rejects a non-admin user with 403', async () => {
    const token = signToken({ sub: 'user-1', tenant_id: 'tenant-1', is_admin: false });
    const response = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Admin privileges required' });
  });

  it('allows an admin user through', async () => {
    const token = signToken({ sub: 'user-1', tenant_id: 'tenant-1', is_admin: true });
    const response = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
  });
});
```

```js
// backend/tests/validation.test.js
const { isUuid, assertUuid, assertRequiredString } = require('../src/utils/validation');

describe('isUuid', () => {
  it('accepts a well-formed UUID', () => {
    expect(isUuid('11111111-1111-1111-1111-111111111111')).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('assertUuid', () => {
  it('throws AppError(400) for a malformed value', () => {
    expect(() => assertUuid('bad-id', 'templateFileId')).toThrow('templateFileId must be a valid UUID');
  });

  it('does not throw for a valid UUID', () => {
    expect(() => assertUuid('11111111-1111-1111-1111-111111111111', 'templateFileId')).not.toThrow();
  });
});

describe('assertRequiredString', () => {
  it('throws for an empty string', () => {
    expect(() => assertRequiredString('', 'name')).toThrow('name is required');
  });

  it('throws for a whitespace-only string', () => {
    expect(() => assertRequiredString('   ', 'name')).toThrow('name is required');
  });

  it('does not throw for a non-empty string', () => {
    expect(() => assertRequiredString('SRS Template', 'name')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/requireAdmin.test.js tests/validation.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `backend/src/middleware/requireAdmin.js`**

```js
const AppError = require('../utils/AppError');

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return next(new AppError(403, 'Admin privileges required'));
  }
  return next();
}

module.exports = { requireAdmin };
```

- [ ] **Step 4: Write `backend/src/utils/validation.js`**

```js
const AppError = require('./AppError');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function assertUuid(value, fieldName) {
  if (!isUuid(value)) {
    throw new AppError(400, `${fieldName} must be a valid UUID`);
  }
}

function assertRequiredString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, `${fieldName} is required`);
  }
}

module.exports = { isUuid, assertUuid, assertRequiredString };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/requireAdmin.test.js tests/validation.test.js`
Expected: PASS, all 8 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/middleware/requireAdmin.js src/utils/validation.js tests/requireAdmin.test.js tests/validation.test.js
git commit -m "feat: add requireAdmin middleware and shared validation utilities"
```

---

## Task 2: Upload validation and local file storage

**Files:**
- Modify: `backend/package.json` (add `multer` dependency)
- Modify: `backend/src/config/env.js` (add `storageDir` to the returned config)
- Modify: `backend/tests/env.test.js` (extend the "fully-populated config" assertion)
- Modify: `backend/.gitignore` and `backend/.env.example` (ignore/document `STORAGE_DIR`)
- Create: `backend/src/config/multerUpload.js`
- Create: `backend/src/utils/fileValidation.js`
- Create: `backend/src/services/fileStorageService.js`
- Test: `backend/tests/fileValidation.test.js`

**Interfaces:**
- Consumes: `AppError` (Phase 0), `validateEnv` (Phase 0, extended here).
- Produces: `upload` (a configured multer instance with `.single(fieldName)`), `assertAllowedUpload(file, allowedExtensions: string[], maxSizeBytes: number)` (throws `AppError(400, ...)`), `saveUploadedFile(tenantId: string, buffer: Buffer, extension: string) -> Promise<string>` (returns a relative path to store in `file_path`). Task 3's template-version upload endpoint uses all three.

- [ ] **Step 1: Add `multer` to `backend/package.json` dependencies**

Add to the `dependencies` block (alphabetical order with the rest):
```json
    "multer": "^1.4.5-lts.1",
```

Run: `cd "d:\Project\Workflow Managment System\backend" && npm install`
Expected: installs cleanly, `node_modules/multer` present.

- [ ] **Step 2: Add `STORAGE_DIR` to env config**

In `backend/.env.example`, add after `CORS_ORIGINS`:
```dotenv
STORAGE_DIR=./storage
```
Do the same in the real `backend/.env`.

In `backend/.gitignore`, add:
```gitignore
storage/
```

- [ ] **Step 3: Extend the failing test first**

In `backend/tests/env.test.js`, change the `db` equality block in "returns a fully-populated config object for valid input" to also assert `storageDir`:

```js
    expect(config.jwtSecret).toBe(validBase.JWT_SECRET);
    expect(config.storageDir).toBe('./storage');
    expect(config.db).toEqual({
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx jest tests/env.test.js`
Expected: FAIL — `config.storageDir` is `undefined`.

- [ ] **Step 5: Update `backend/src/config/env.js`**

Add `storageDir` to the returned object, right after `corsOrigins`:
```js
    storageDir: env.STORAGE_DIR || './storage',
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest tests/env.test.js`
Expected: PASS, all 5 tests green.

- [ ] **Step 7: Write the failing test for file validation**

```js
// backend/tests/fileValidation.test.js
const { assertAllowedUpload } = require('../src/utils/fileValidation');

describe('assertAllowedUpload', () => {
  const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(10)]);

  it('accepts a valid docx-shaped file within limits', () => {
    const file = { originalname: 'template.docx', size: validDocxBuffer.length, buffer: validDocxBuffer };
    expect(() => assertAllowedUpload(file, ['docx'], 1024)).not.toThrow();
  });

  it('rejects a disallowed extension', () => {
    const file = { originalname: 'template.exe', size: validDocxBuffer.length, buffer: validDocxBuffer };
    expect(() => assertAllowedUpload(file, ['docx'], 1024)).toThrow('not allowed');
  });

  it('rejects a file exceeding the size cap', () => {
    const file = { originalname: 'template.docx', size: 2048, buffer: validDocxBuffer };
    expect(() => assertAllowedUpload(file, ['docx'], 1024)).toThrow('maximum allowed size');
  });

  it('rejects a file whose content does not match the expected signature', () => {
    const fakeBuffer = Buffer.from('not a real office document');
    const file = { originalname: 'template.docx', size: fakeBuffer.length, buffer: fakeBuffer };
    expect(() => assertAllowedUpload(file, ['docx'], 1024)).toThrow('signature');
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx jest tests/fileValidation.test.js`
Expected: FAIL — module not found.

- [ ] **Step 9: Write `backend/src/utils/fileValidation.js`**

```js
const AppError = require('./AppError');

// docx/xlsx/pptx are all ZIP-based OOXML containers; every ZIP starts with 'PK'.
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b]);

function assertAllowedUpload(file, allowedExtensions, maxSizeBytes) {
  const extension = file.originalname.split('.').pop().toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    throw new AppError(400, `File extension .${extension} is not allowed`);
  }

  if (file.size > maxSizeBytes) {
    throw new AppError(400, `File exceeds the maximum allowed size of ${maxSizeBytes} bytes`);
  }

  if (!file.buffer || file.buffer.length < 2 || !file.buffer.subarray(0, 2).equals(ZIP_SIGNATURE)) {
    throw new AppError(400, 'File content does not match a valid Office document signature');
  }
}

module.exports = { assertAllowedUpload };
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx jest tests/fileValidation.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 11: Write `backend/src/config/multerUpload.js`**

```js
const multer = require('multer');

// Hard ceiling at the transport layer; per-document-type caps are enforced
// by assertAllowedUpload in application code.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

module.exports = { upload };
```

- [ ] **Step 12: Write `backend/src/services/fileStorageService.js`**

```js
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { validateEnv } = require('../config/env');

const config = validateEnv();
const STORAGE_ROOT = path.resolve(process.cwd(), config.storageDir);

async function saveUploadedFile(tenantId, buffer, extension) {
  const tenantDir = path.join(STORAGE_ROOT, tenantId);
  await fs.mkdir(tenantDir, { recursive: true });

  const fileName = `${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(tenantDir, fileName), buffer);

  return path.join(tenantId, fileName);
}

module.exports = { saveUploadedFile };
```

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore src/config/env.js src/config/multerUpload.js src/utils/fileValidation.js src/services/fileStorageService.js tests/env.test.js tests/fileValidation.test.js
git commit -m "feat: add upload validation and local file storage"
```

---

## Task 3: Template files admin API (upload and version)

**Files:**
- Create: `backend/src/services/templateFileService.js`
- Create: `backend/src/routes/admin/templateFiles.js`
- Modify: `backend/src/app.js` (mount the router)
- Test: `backend/tests/templateFiles.test.js`

**Interfaces:**
- Consumes: `assertUuid`, `assertRequiredString` (Task 1), `assertAllowedUpload`, `saveUploadedFile`, `upload` (Task 2), `requireAdmin`, `authenticate`.
- Produces: `POST /admin/template-files`, `GET /admin/template-files`, `GET /admin/template-files/:id`, `POST /admin/template-files/:id/versions`. Task 6 (document types) references `template_files` rows by ID created here.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/templateFiles.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('template files admin API', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Template Files Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'tf-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('template_file_versions').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ id: ADMIN_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app).post('/admin/template-files').send({ name: 'SRS Template' });
    expect(response.status).toBe(401);
  });

  it('creates a template file, uploads two versions, and lists them', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SRS Template' });
    expect(createResponse.status).toBe(201);
    const templateFileId = createResponse.body.id;

    const firstUpload = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'srs-v1.docx');
    expect(firstUpload.status).toBe(201);
    expect(firstUpload.body.version_number).toBe(1);

    const secondUpload = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'srs-v2.docx');
    expect(secondUpload.status).toBe(201);
    expect(secondUpload.body.version_number).toBe(2);

    const detailResponse = await request(app)
      .get(`/admin/template-files/${templateFileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.versions).toHaveLength(2);

    const listResponse = await request(app)
      .get('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((t) => t.id === templateFileId)).toBe(true);
  });

  it('rejects an upload with a disallowed extension', async () => {
    const createResponse = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad Extension Template' });
    const templateFileId = createResponse.body.id;

    const response = await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'malicious.exe');
    expect(response.status).toBe(400);
  });

  it('returns 404 for a template file that does not belong to the caller', async () => {
    const response = await request(app)
      .get('/admin/template-files/99999999-9999-9999-9999-999999999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/templateFiles.test.js`
Expected: FAIL — modules not found / route not mounted.

- [ ] **Step 3: Write `backend/src/services/templateFileService.js`**

```js
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');
const { assertAllowedUpload } = require('../utils/fileValidation');
const { saveUploadedFile } = require('./fileStorageService');

const ALLOWED_TEMPLATE_EXTENSIONS = ['docx'];
const MAX_TEMPLATE_UPLOAD_BYTES = 10 * 1024 * 1024;

async function createTemplateFile(tenantId, name) {
  assertRequiredString(name, 'name');
  const [templateFile] = await db('template_files').insert({ tenant_id: tenantId, name }).returning('*');
  return templateFile;
}

async function listTemplateFiles(tenantId) {
  return db('template_files').where({ tenant_id: tenantId }).orderBy('created_at', 'desc');
}

async function getTemplateFile(tenantId, templateFileId) {
  assertUuid(templateFileId, 'templateFileId');
  const templateFile = await db('template_files').where({ tenant_id: tenantId, id: templateFileId }).first();
  if (!templateFile) {
    throw new AppError(404, 'Template file not found');
  }
  const versions = await db('template_file_versions')
    .where({ tenant_id: tenantId, template_file_id: templateFileId })
    .orderBy('version_number', 'desc');
  return { ...templateFile, versions };
}

async function addTemplateFileVersion(tenantId, templateFileId, uploadedBy, file) {
  assertUuid(templateFileId, 'templateFileId');
  const templateFile = await db('template_files').where({ tenant_id: tenantId, id: templateFileId }).first();
  if (!templateFile) {
    throw new AppError(404, 'Template file not found');
  }

  assertAllowedUpload(file, ALLOWED_TEMPLATE_EXTENSIONS, MAX_TEMPLATE_UPLOAD_BYTES);

  const latestVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, template_file_id: templateFileId })
    .max('version_number as max')
    .first();
  const nextVersionNumber = (latestVersion && latestVersion.max ? latestVersion.max : 0) + 1;

  const extension = file.originalname.split('.').pop().toLowerCase();
  const relativePath = await saveUploadedFile(tenantId, file.buffer, extension);

  const [version] = await db('template_file_versions')
    .insert({
      tenant_id: tenantId,
      template_file_id: templateFileId,
      version_number: nextVersionNumber,
      file_path: relativePath,
      uploaded_by: uploadedBy,
    })
    .returning('*');

  return version;
}

module.exports = { createTemplateFile, listTemplateFiles, getTemplateFile, addTemplateFileVersion };
```

- [ ] **Step 4: Write `backend/src/routes/admin/templateFiles.js`**

```js
const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { upload } = require('../../config/multerUpload');
const {
  createTemplateFile,
  listTemplateFiles,
  getTemplateFile,
  addTemplateFileVersion,
} = require('../../services/templateFileService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post('/', async (req, res, next) => {
  try {
    const templateFile = await createTemplateFile(req.user.tenantId, req.body.name);
    res.status(201).json(templateFile);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const templateFiles = await listTemplateFiles(req.user.tenantId);
    res.status(200).json(templateFiles);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const templateFile = await getTemplateFile(req.user.tenantId, req.params.id);
    res.status(200).json(templateFile);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/versions', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }
    const version = await addTemplateFileVersion(req.user.tenantId, req.params.id, req.user.userId, req.file);
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Mount the router in `backend/src/app.js`**

Add with the other route imports:
```js
const templateFilesRouter = require('./routes/admin/templateFiles');
```
Add next to `app.use('/auth', authRouter);`:
```js
app.use('/admin/template-files', templateFilesRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/templateFiles.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/services/templateFileService.js src/routes/admin/templateFiles.js src/app.js tests/templateFiles.test.js
git commit -m "feat: add template files admin API (upload and version)"
```

---

## Task 4: Workflow templates admin API

**Files:**
- Create: `backend/src/services/workflowTemplateService.js`
- Create: `backend/src/routes/admin/workflowTemplates.js`
- Modify: `backend/src/app.js` (mount the router)
- Test: `backend/tests/workflowTemplates.test.js`

**Interfaces:**
- Consumes: `assertUuid`, `assertRequiredString` (Task 1), `requireAdmin`, `authenticate`.
- Produces: `POST /admin/workflow-templates`, `GET /admin/workflow-templates`, `GET /admin/workflow-templates/:id` (includes `stages: []`, populated once Task 5 adds stages). `createWorkflowTemplate`, `listWorkflowTemplates`, `getWorkflowTemplate` exported from the service — Task 5 adds `addWorkflowStage` to this same service file; Task 6 references `workflow_templates` rows by ID.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/workflowTemplates.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = '55555555-5555-5555-5555-555555555555';
const ADMIN_ID = '66666666-6666-6666-6666-666666666666';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('workflow templates admin API', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Workflow Templates Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'wt-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ id: ADMIN_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('creates, lists, and fetches a workflow template with an empty stage list', async () => {
    const createResponse = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '3-Stage Approval' });
    expect(createResponse.status).toBe(201);
    const workflowTemplateId = createResponse.body.id;

    const listResponse = await request(app)
      .get('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((w) => w.id === workflowTemplateId)).toBe(true);

    const detailResponse = await request(app)
      .get(`/admin/workflow-templates/${workflowTemplateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.stages).toEqual([]);
  });

  it('returns 400 when name is missing', async () => {
    const response = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/workflowTemplates.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `backend/src/services/workflowTemplateService.js`**

```js
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');

async function createWorkflowTemplate(tenantId, name) {
  assertRequiredString(name, 'name');
  const [workflowTemplate] = await db('workflow_templates').insert({ tenant_id: tenantId, name }).returning('*');
  return workflowTemplate;
}

async function listWorkflowTemplates(tenantId) {
  return db('workflow_templates').where({ tenant_id: tenantId }).orderBy('created_at', 'desc');
}

async function getWorkflowTemplate(tenantId, workflowTemplateId) {
  assertUuid(workflowTemplateId, 'workflowTemplateId');
  const workflowTemplate = await db('workflow_templates')
    .where({ tenant_id: tenantId, id: workflowTemplateId })
    .first();
  if (!workflowTemplate) {
    throw new AppError(404, 'Workflow template not found');
  }
  const stages = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId })
    .orderBy('stage_order', 'asc');
  return { ...workflowTemplate, stages };
}

module.exports = { createWorkflowTemplate, listWorkflowTemplates, getWorkflowTemplate };
```

- [ ] **Step 4: Write `backend/src/routes/admin/workflowTemplates.js`**

```js
const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const {
  createWorkflowTemplate,
  listWorkflowTemplates,
  getWorkflowTemplate,
} = require('../../services/workflowTemplateService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post('/', async (req, res, next) => {
  try {
    const workflowTemplate = await createWorkflowTemplate(req.user.tenantId, req.body.name);
    res.status(201).json(workflowTemplate);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const workflowTemplates = await listWorkflowTemplates(req.user.tenantId);
    res.status(200).json(workflowTemplates);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const workflowTemplate = await getWorkflowTemplate(req.user.tenantId, req.params.id);
    res.status(200).json(workflowTemplate);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Mount the router in `backend/src/app.js`**

Add with the other route imports:
```js
const workflowTemplatesRouter = require('./routes/admin/workflowTemplates');
```
Add next to the template-files mount:
```js
app.use('/admin/workflow-templates', workflowTemplatesRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/workflowTemplates.test.js`
Expected: PASS, all 2 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/services/workflowTemplateService.js src/routes/admin/workflowTemplates.js src/app.js tests/workflowTemplates.test.js
git commit -m "feat: add workflow templates admin API"
```

---

## Task 5: Workflow stages (the stage builder)

**Files:**
- Modify: `backend/src/services/workflowTemplateService.js` (add `addWorkflowStage`)
- Modify: `backend/src/routes/admin/workflowTemplates.js` (add the stages sub-route)
- Test: `backend/tests/workflowStages.test.js`

**Interfaces:**
- Consumes: `assertUuid`, `assertRequiredString` (Task 1); `users`, `roles` tables (Phase 0 schema).
- Produces: `POST /admin/workflow-templates/:id/stages`; `addWorkflowStage(tenantId, workflowTemplateId, input) -> Promise<stage>` added to `workflowTemplateService.js`. Task 7's end-to-end walkthrough uses this to build a 3-stage workflow.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/workflowStages.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = '77777777-7777-7777-7777-777777777777';
const ADMIN_ID = '88888888-8888-8888-8888-888888888888';
const OTHER_USER_ID = '99999999-8888-7777-6666-555555555555';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('workflow stages admin API', () => {
  let workflowTemplateId;
  let roleId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Workflow Stages Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ws-admin@example.com', password_hash: 'x', is_admin: true },
        { id: OTHER_USER_ID, tenant_id: TENANT_ID, email: 'ws-stage1@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [role] = await db('roles').insert({ tenant_id: TENANT_ID, name: 'Reviewer' }).returning('id');
    roleId = role.id;

    const createResponse = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '3-Stage Approval' });
    workflowTemplateId = createResponse.body.id;
  });

  afterAll(async () => {
    await db('workflow_stages').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('roles').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('adds a user-assigned stage, then a role-assigned stage, in order', async () => {
    const stage1 = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: OTHER_USER_ID });
    expect(stage1.status).toBe(201);

    const stage2 = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 2, name: 'Review', assigneeType: 'role', assigneeRoleId: roleId });
    expect(stage2.status).toBe(201);

    const detail = await request(app)
      .get(`/admin/workflow-templates/${workflowTemplateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.stages.map((s) => s.stage_order)).toEqual([1, 2]);
  });

  it('rejects a duplicate stage_order on the same workflow template', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Duplicate', assigneeType: 'user', assigneeUserId: OTHER_USER_ID });
    expect(response.status).toBe(400);
  });

  it('rejects an assigneeUserId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        stageOrder: 3,
        name: 'Bad Assignee',
        assigneeType: 'user',
        assigneeUserId: '00000000-1111-2222-3333-444444444444',
      });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid assigneeType', async () => {
    const response = await request(app)
      .post(`/admin/workflow-templates/${workflowTemplateId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 3, name: 'Bad Type', assigneeType: 'robot' });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/workflowStages.test.js`
Expected: FAIL — 404, route does not exist yet.

- [ ] **Step 3: Add `addWorkflowStage` to `backend/src/services/workflowTemplateService.js`**

Append to the file, before `module.exports`:
```js
const ALLOWED_ASSIGNEE_TYPES = ['user', 'role'];
const ALLOWED_ACTIONS = ['forward', 'send_back', 'reject'];

async function addWorkflowStage(tenantId, workflowTemplateId, input) {
  assertUuid(workflowTemplateId, 'workflowTemplateId');
  const workflowTemplate = await db('workflow_templates')
    .where({ tenant_id: tenantId, id: workflowTemplateId })
    .first();
  if (!workflowTemplate) {
    throw new AppError(404, 'Workflow template not found');
  }

  const { stageOrder, name, assigneeType, assigneeUserId, assigneeRoleId, allowedActions } = input;

  if (!Number.isInteger(stageOrder) || stageOrder < 1) {
    throw new AppError(400, 'stageOrder must be a positive integer');
  }
  assertRequiredString(name, 'name');
  if (!ALLOWED_ASSIGNEE_TYPES.includes(assigneeType)) {
    throw new AppError(400, `assigneeType must be one of: ${ALLOWED_ASSIGNEE_TYPES.join(', ')}`);
  }

  if (assigneeType === 'user') {
    assertUuid(assigneeUserId, 'assigneeUserId');
    const user = await db('users').where({ tenant_id: tenantId, id: assigneeUserId }).first();
    if (!user) {
      throw new AppError(400, 'assigneeUserId does not belong to this tenant');
    }
  } else {
    assertUuid(assigneeRoleId, 'assigneeRoleId');
    const role = await db('roles').where({ tenant_id: tenantId, id: assigneeRoleId }).first();
    if (!role) {
      throw new AppError(400, 'assigneeRoleId does not belong to this tenant');
    }
  }

  const actions = Array.isArray(allowedActions) && allowedActions.length > 0 ? allowedActions : ALLOWED_ACTIONS;
  const invalidAction = actions.find((action) => !ALLOWED_ACTIONS.includes(action));
  if (invalidAction) {
    throw new AppError(400, `Invalid action "${invalidAction}". Allowed actions: ${ALLOWED_ACTIONS.join(', ')}`);
  }

  const existingStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId, stage_order: stageOrder })
    .first();
  if (existingStage) {
    throw new AppError(400, `stageOrder ${stageOrder} already exists on this workflow template`);
  }

  const [stage] = await db('workflow_stages')
    .insert({
      tenant_id: tenantId,
      workflow_template_id: workflowTemplateId,
      stage_order: stageOrder,
      name,
      assignee_type: assigneeType,
      assignee_user_id: assigneeType === 'user' ? assigneeUserId : null,
      assignee_role_id: assigneeType === 'role' ? assigneeRoleId : null,
      allowed_actions: JSON.stringify(actions),
    })
    .returning('*');

  return stage;
}
```

Update the `module.exports` line to:
```js
module.exports = { createWorkflowTemplate, listWorkflowTemplates, getWorkflowTemplate, addWorkflowStage };
```

- [ ] **Step 4: Add the sub-route in `backend/src/routes/admin/workflowTemplates.js`**

Update the destructured import at the top:
```js
const {
  createWorkflowTemplate,
  listWorkflowTemplates,
  getWorkflowTemplate,
  addWorkflowStage,
} = require('../../services/workflowTemplateService');
```

Add before `module.exports = router;`:
```js
router.post('/:id/stages', async (req, res, next) => {
  try {
    const stage = await addWorkflowStage(req.user.tenantId, req.params.id, req.body);
    res.status(201).json(stage);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/workflowStages.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/workflowTemplateService.js src/routes/admin/workflowTemplates.js tests/workflowStages.test.js
git commit -m "feat: add workflow stage builder to workflow templates API"
```

---

## Task 6: Document types CRUD

**Files:**
- Create: `backend/src/services/documentTypeService.js`
- Create: `backend/src/routes/admin/documentTypes.js`
- Modify: `backend/src/app.js` (mount the router)
- Test: `backend/tests/documentTypes.test.js`

**Interfaces:**
- Consumes: `assertUuid`, `assertRequiredString` (Task 1); `template_files` (Task 3), `workflow_templates` (Task 4) rows.
- Produces: `POST /admin/document-types`, `GET /admin/document-types`, `GET /admin/document-types/:id`, `PATCH /admin/document-types/:id`, `DELETE /admin/document-types/:id`. Phase 2's workflow-instance creation will reference `document_types` rows created here.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/documentTypes.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'aaaaaaaa-1111-1111-1111-111111111111';
const ADMIN_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });

describe('document types admin API', () => {
  let templateFileId;
  let workflowTemplateId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Document Types Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: ADMIN_ID, tenant_id: TENANT_ID, email: 'dt-admin@example.com', password_hash: 'x', is_admin: true })
      .onConflict('id')
      .ignore();
    const [templateFile] = await db('template_files').insert({ tenant_id: TENANT_ID, name: 'HR Letter' }).returning('id');
    templateFileId = templateFile.id;
    const [workflowTemplate] = await db('workflow_templates')
      .insert({ tenant_id: TENANT_ID, name: 'HR Approval' })
      .returning('id');
    workflowTemplateId = workflowTemplate.id;
  });

  afterAll(async () => {
    await db('document_types').where({ tenant_id: TENANT_ID }).del();
    await db('workflow_templates').where({ tenant_id: TENANT_ID }).del();
    await db('template_files').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('creates, lists, fetches, updates, and deletes a document type', async () => {
    const createResponse = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HR Letter', templateFileId, workflowTemplateId });
    expect(createResponse.status).toBe(201);
    const documentTypeId = createResponse.body.id;
    expect(createResponse.body.allowed_extensions).toEqual(['docx']);

    const listResponse = await request(app)
      .get('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.body.some((d) => d.id === documentTypeId)).toBe(true);

    const getResponse = await request(app)
      .get(`/admin/document-types/${documentTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.status).toBe(200);

    const updateResponse = await request(app)
      .patch(`/admin/document-types/${documentTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HR Letter (Updated)' });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.name).toBe('HR Letter (Updated)');

    const deleteResponse = await request(app)
      .delete(`/admin/document-types/${documentTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await request(app)
      .get(`/admin/document-types/${documentTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterDelete.status).toBe(404);
  });

  it('rejects a templateFileId that does not belong to the tenant', async () => {
    const response = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Cross Tenant',
        templateFileId: '00000000-0000-0000-0000-000000000099',
        workflowTemplateId,
      });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/documentTypes.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `backend/src/services/documentTypeService.js`**

```js
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');

const DEFAULT_ALLOWED_EXTENSIONS = ['docx'];
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

async function assertBelongsToTenant(tenantId, table, id, label) {
  assertUuid(id, label);
  const row = await db(table).where({ tenant_id: tenantId, id }).first();
  if (!row) {
    throw new AppError(400, `${label} does not belong to this tenant`);
  }
}

async function createDocumentType(tenantId, input) {
  const { name, templateFileId, workflowTemplateId, allowedExtensions, maxUploadSizeBytes } = input;
  assertRequiredString(name, 'name');
  await assertBelongsToTenant(tenantId, 'template_files', templateFileId, 'templateFileId');
  await assertBelongsToTenant(tenantId, 'workflow_templates', workflowTemplateId, 'workflowTemplateId');

  const [documentType] = await db('document_types')
    .insert({
      tenant_id: tenantId,
      name,
      template_file_id: templateFileId,
      workflow_template_id: workflowTemplateId,
      allowed_extensions: JSON.stringify(
        Array.isArray(allowedExtensions) && allowedExtensions.length > 0
          ? allowedExtensions
          : DEFAULT_ALLOWED_EXTENSIONS,
      ),
      max_upload_size_bytes:
        Number.isInteger(maxUploadSizeBytes) && maxUploadSizeBytes > 0
          ? maxUploadSizeBytes
          : DEFAULT_MAX_UPLOAD_SIZE_BYTES,
    })
    .returning('*');

  return documentType;
}

async function listDocumentTypes(tenantId) {
  return db('document_types').where({ tenant_id: tenantId }).orderBy('created_at', 'desc');
}

async function getDocumentType(tenantId, id) {
  assertUuid(id, 'id');
  const documentType = await db('document_types').where({ tenant_id: tenantId, id }).first();
  if (!documentType) {
    throw new AppError(404, 'Document type not found');
  }
  return documentType;
}

async function updateDocumentType(tenantId, id, input) {
  await getDocumentType(tenantId, id);
  const { name, allowedExtensions, maxUploadSizeBytes } = input;

  const updates = {};
  if (name !== undefined) {
    assertRequiredString(name, 'name');
    updates.name = name;
  }
  if (allowedExtensions !== undefined) {
    if (!Array.isArray(allowedExtensions) || allowedExtensions.length === 0) {
      throw new AppError(400, 'allowedExtensions must be a non-empty array');
    }
    updates.allowed_extensions = JSON.stringify(allowedExtensions);
  }
  if (maxUploadSizeBytes !== undefined) {
    if (!Number.isInteger(maxUploadSizeBytes) || maxUploadSizeBytes <= 0) {
      throw new AppError(400, 'maxUploadSizeBytes must be a positive integer');
    }
    updates.max_upload_size_bytes = maxUploadSizeBytes;
  }

  if (Object.keys(updates).length === 0) {
    return getDocumentType(tenantId, id);
  }

  const [updated] = await db('document_types').where({ tenant_id: tenantId, id }).update(updates).returning('*');
  return updated;
}

async function deleteDocumentType(tenantId, id) {
  await getDocumentType(tenantId, id);
  await db('document_types').where({ tenant_id: tenantId, id }).del();
}

module.exports = {
  createDocumentType,
  listDocumentTypes,
  getDocumentType,
  updateDocumentType,
  deleteDocumentType,
};
```

- [ ] **Step 4: Write `backend/src/routes/admin/documentTypes.js`**

```js
const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const {
  createDocumentType,
  listDocumentTypes,
  getDocumentType,
  updateDocumentType,
  deleteDocumentType,
} = require('../../services/documentTypeService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post('/', async (req, res, next) => {
  try {
    const documentType = await createDocumentType(req.user.tenantId, req.body);
    res.status(201).json(documentType);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const documentTypes = await listDocumentTypes(req.user.tenantId);
    res.status(200).json(documentTypes);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const documentType = await getDocumentType(req.user.tenantId, req.params.id);
    res.status(200).json(documentType);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const documentType = await updateDocumentType(req.user.tenantId, req.params.id, req.body);
    res.status(200).json(documentType);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteDocumentType(req.user.tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Mount the router in `backend/src/app.js`**

Add with the other route imports:
```js
const documentTypesRouter = require('./routes/admin/documentTypes');
```
Add next to the workflow-templates mount:
```js
app.use('/admin/document-types', documentTypesRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/documentTypes.test.js`
Expected: PASS, all 2 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/services/documentTypeService.js src/routes/admin/documentTypes.js src/app.js tests/documentTypes.test.js
git commit -m "feat: add document types CRUD admin API"
```

---

## Task 7: End-to-end exit-criteria verification

**Files:** none created — verification only.

- [ ] **Step 1: Run the full automated test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all suites pass (Phase 0's 19 tests + this phase's new tests).

- [ ] **Step 2: Walk a 3-stage workflow configuration end to end via curl, using only API calls**

With `docker compose up -d postgres`, `npm run migrate`, `npm run seed`, and `npm run dev` running, obtain an admin token and use it for every call below:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@dev.local","password":"ChangeMe123!"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")

TEMPLATE_FILE_ID=$(curl -s -X POST http://localhost:3000/admin/template-files -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"SRS Template"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).id))")

curl -s -X POST http://localhost:3000/admin/template-files/$TEMPLATE_FILE_ID/versions -H "Authorization: Bearer $TOKEN" -F "file=@some-real.docx"

WORKFLOW_TEMPLATE_ID=$(curl -s -X POST http://localhost:3000/admin/workflow-templates -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"SRS Approval"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).id))")

curl -s -X POST http://localhost:3000/admin/workflow-templates/$WORKFLOW_TEMPLATE_ID/stages -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"stageOrder\":1,\"name\":\"Draft\",\"assigneeType\":\"user\",\"assigneeUserId\":\"00000000-0000-0000-0000-000000000002\"}"
curl -s -X POST http://localhost:3000/admin/workflow-templates/$WORKFLOW_TEMPLATE_ID/stages -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"stageOrder\":2,\"name\":\"Review\",\"assigneeType\":\"user\",\"assigneeUserId\":\"00000000-0000-0000-0000-000000000002\"}"
curl -s -X POST http://localhost:3000/admin/workflow-templates/$WORKFLOW_TEMPLATE_ID/stages -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"stageOrder\":3,\"name\":\"Final Approval\",\"assigneeType\":\"user\",\"assigneeUserId\":\"00000000-0000-0000-0000-000000000002\"}"

curl -s -X POST http://localhost:3000/admin/document-types -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"name\":\"SRS\",\"templateFileId\":\"$TEMPLATE_FILE_ID\",\"workflowTemplateId\":\"$WORKFLOW_TEMPLATE_ID\"}"

curl -s http://localhost:3000/admin/workflow-templates/$WORKFLOW_TEMPLATE_ID -H "Authorization: Bearer $TOKEN"
```

Expected: every call succeeds; the final `GET` shows a workflow template with exactly 3 stages in order, and a `document_types` row links the template file to the workflow template — all without touching the database directly.

- [ ] **Step 3: Update `PROGRESS.md` with the Phase 1 completion summary and commit**

```bash
git add PROGRESS.md
git commit -m "docs: update progress log for Phase 1 completion"
```

## Phase 1 Exit Criteria (verify all before moving to Phase 2)

- [ ] An admin can create a template file, upload multiple versions, and see all versions in order, entirely via API calls.
- [ ] An admin can build a workflow template with ordered stages, mixing user- and role-assigned stages, entirely via API calls.
- [ ] An admin can CRUD a document type linking a template file to a workflow template, entirely via API calls.
- [ ] Every admin route rejects non-admin and unauthenticated callers (403 / 401 respectively).
- [ ] Every cross-tenant reference (a template file, workflow template, user, or role ID from another tenant) is rejected with 400/404, never silently accepted.
- [ ] Upload validation rejects disallowed extensions and content that fails the signature check.
- [ ] Full test suite passes.
