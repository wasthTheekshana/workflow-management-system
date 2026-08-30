# OnlyOffice-1 — Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the frontend everything it needs to embed a real in-browser `.docx` editor: a Docker-hosted OnlyOffice Document Server, signed editor configs for template files and instances, a signed short-lived download endpoint the Document Server uses to fetch files, and a save-callback endpoint that turns an edit session into a new version — reusing the exact validation and versioning logic the existing upload path already uses.

**Architecture:** `documentEditingService.js` builds and signs OnlyOffice editor configs. `templateFileService.js` and `workflowInstanceService.js` each expose a new buffer-based save function (`saveTemplateFileVersionBuffer` / `saveInstanceVersionBuffer`) that the existing multer-upload path and the new callback path both call — one place decides "how a version gets created," fed by either a multer file or a downloaded buffer. A new `downloadToken` utility signs/verifies narrowly-scoped, short-lived JWTs (using the app's own `JWT_SECRET`) so the Document Server can fetch a file without a normal user session.

**Tech Stack:** No new npm dependencies — Node 24's global `fetch` covers the outbound HTTP the callback needs; `jsonwebtoken` (already a dependency) signs both the download tokens and the OnlyOffice configs. One new Docker service: `onlyoffice/documentserver`.

**Spec:** `docs/superpowers/specs/2026-08-28-inbrowser-document-editing-design.md`

## Global Constraints

- `ONLYOFFICE_JWT_SECRET` is a distinct secret from the app's own `JWT_SECRET` — never reused across the two trust boundaries (user auth vs. Document Server auth). Fail-fast at boot if missing or under 32 characters, same pattern as `JWT_SECRET`. (Spec §2, §4.1)
- The callback endpoint (`POST /files/callback/*`) has no `authenticate` middleware — the Document Server carries no user session. Its only trust boundary is the verified OnlyOffice JWT; every other input (`tenantId`, `actorUserId` from the query string) is validated against the database before use, exactly like every other service function in this codebase. (Spec §4.5)
- The signed download token (`GET /files/signed-download`) is scoped to exactly one file path and expires in 5 minutes. (Spec §4.2)
- The existing upload (`POST .../versions`) and download (`GET .../current-file`) endpoints are untouched — this phase only adds new routes and extracts shared logic, it does not change any existing route's behavior or response shape. (Spec §2 "Coexistence with upload/download")
- `docker-compose.yml`'s new `onlyoffice` service binds to `127.0.0.1` only, matching the existing Postgres/API port-binding convention. (Spec §4.5)

---

## Task 1: Docker Compose service and environment configuration

**Files:**
- Modify: `backend/docker-compose.yml` (add the `onlyoffice` service)
- Modify: `backend/.env.example` and `backend/.env` (new variables)
- Modify: `backend/src/config/env.js` (add `onlyoffice` to the returned config, fail-fast on a short/missing secret)
- Modify: `backend/tests/env.test.js` (extend the fixtures and assertions)

**Interfaces:**
- Produces: `config.onlyoffice.jwtSecret`, `config.onlyoffice.documentServerUrl`, `config.onlyoffice.callbackBaseUrl` from `validateEnv()`. Every later task in this plan reads these.

- [ ] **Step 1: Add the `onlyoffice` service to `backend/docker-compose.yml`**

Add as a sibling of the existing `postgres` and `api` services:
```yaml
  onlyoffice:
    image: onlyoffice/documentserver:latest
    restart: unless-stopped
    environment:
      JWT_ENABLED: "true"
      JWT_SECRET: ${ONLYOFFICE_JWT_SECRET}
      JWT_HEADER: Authorization
    ports:
      - "127.0.0.1:8082:80"
```

- [ ] **Step 2: Add the new variables to `backend/.env.example`**

Append:
```dotenv
ONLYOFFICE_JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
ONLYOFFICE_DOCUMENT_SERVER_URL=http://localhost:8082
ONLYOFFICE_CALLBACK_BASE_URL=http://host.docker.internal:3000
```

- [ ] **Step 3: Generate a real secret and add the same block to the real `backend/.env`**

Run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Add the output as `ONLYOFFICE_JWT_SECRET` in `backend/.env`, plus the same `ONLYOFFICE_DOCUMENT_SERVER_URL` and `ONLYOFFICE_CALLBACK_BASE_URL` lines as Step 2.

- [ ] **Step 4: Extend the failing test first**

In `backend/tests/env.test.js`, add `ONLYOFFICE_JWT_SECRET: 'b'.repeat(32)` to `validBase`, and add this assertion to "returns a fully-populated config object for valid input", after the `smtp` assertion:

```js
    expect(config.onlyoffice).toEqual({
      jwtSecret: 'b'.repeat(32),
      documentServerUrl: 'http://localhost:8082',
      callbackBaseUrl: 'http://host.docker.internal:3000',
    });
```

Also add one new test case:
```js
  it('throws when ONLYOFFICE_JWT_SECRET is missing', () => {
    const env = { ...validBase, ONLYOFFICE_JWT_SECRET: '' };
    expect(() => validateEnv(env)).toThrow('ONLYOFFICE_JWT_SECRET');
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/env.test.js`
Expected: FAIL — `config.onlyoffice` is `undefined`; the new secret-missing test also fails since nothing checks for it yet.

- [ ] **Step 6: Update `backend/src/config/env.js`**

Add to the `errors` checks, alongside the `JWT_SECRET` check:
```js
  if (!env.ONLYOFFICE_JWT_SECRET || env.ONLYOFFICE_JWT_SECRET.length < 32) {
    errors.push('ONLYOFFICE_JWT_SECRET must be set and at least 32 characters long');
  }
```

Add to the returned object, after `smtp`:
```js
    onlyoffice: {
      jwtSecret: env.ONLYOFFICE_JWT_SECRET,
      documentServerUrl: env.ONLYOFFICE_DOCUMENT_SERVER_URL || 'http://localhost:8082',
      callbackBaseUrl: env.ONLYOFFICE_CALLBACK_BASE_URL || 'http://host.docker.internal:3000',
    },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest tests/env.test.js`
Expected: PASS, all 7 tests green.

- [ ] **Step 8: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add backend/docker-compose.yml backend/.env.example backend/src/config/env.js backend/tests/env.test.js
git commit -m "feat: add OnlyOffice Document Server config and Docker service"
```

---

## Task 2: Signed download tokens and the signed-download endpoint

**Files:**
- Create: `backend/src/utils/downloadToken.js`
- Create: `backend/src/routes/files.js`
- Modify: `backend/src/app.js` (mount the router)
- Test: `backend/tests/downloadToken.test.js`
- Test: `backend/tests/signedDownload.test.js`

**Interfaces:**
- Produces: `signDownloadToken(filePath: string) -> string`, `verifyDownloadToken(token: string) -> { filePath: string }` (throws `AppError(401, ...)` on invalid/expired); `GET /files/signed-download?token=...`. Task 4's `documentEditingService.js` calls `signDownloadToken`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/downloadToken.test.js
const jwt = require('jsonwebtoken');
const { signDownloadToken, verifyDownloadToken } = require('../src/utils/downloadToken');
const { validateEnv } = require('../src/config/env');

describe('downloadToken', () => {
  it('round-trips a file path through sign and verify', () => {
    const token = signDownloadToken('tenant-1/some-file.docx');
    const { filePath } = verifyDownloadToken(token);
    expect(filePath).toBe('tenant-1/some-file.docx');
  });

  it('rejects a token signed with a different secret', () => {
    const tampered = jwt.sign({ filePath: 'x' }, 'a-completely-different-secret-value-here', {
      algorithm: 'HS256',
    });
    expect(() => verifyDownloadToken(tampered)).toThrow();
  });

  it('rejects an expired token', () => {
    const config = validateEnv();
    const expired = jwt.sign({ filePath: 'x' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: -10 });
    expect(() => verifyDownloadToken(expired)).toThrow('expired');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/downloadToken.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `backend/src/utils/downloadToken.js`**

```js
const jwt = require('jsonwebtoken');
const { validateEnv } = require('../config/env');
const AppError = require('./AppError');

const DOWNLOAD_TOKEN_EXPIRES_IN = '5m';

function signDownloadToken(filePath) {
  const config = validateEnv();
  return jwt.sign({ filePath }, config.jwtSecret, { algorithm: 'HS256', expiresIn: DOWNLOAD_TOKEN_EXPIRES_IN });
}

function verifyDownloadToken(token) {
  const config = validateEnv();
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return { filePath: payload.filePath };
  } catch (err) {
    throw new AppError(401, 'Invalid or expired download token');
  }
}

module.exports = { signDownloadToken, verifyDownloadToken };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/downloadToken.test.js`
Expected: PASS, all 3 tests green. (The "expired" test's error message check works because `jwt.verify` throws `TokenExpiredError`, but our wrapper re-throws a generic `AppError` — adjust the assertion to check `toThrow()` only, not the message, since the wrapper intentionally doesn't distinguish expired-vs-invalid to the caller. Fix the test to `expect(() => verifyDownloadToken(expired)).toThrow();` without a message match.)

- [ ] **Step 5: Write the failing test for the endpoint**

```js
// backend/tests/signedDownload.test.js
const fs = require('fs/promises');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const { signDownloadToken } = require('../src/utils/downloadToken');
const { STORAGE_ROOT } = require('../src/services/fileStorageService');

const TEST_TENANT_DIR = 'signed-download-test-tenant';
const TEST_FILE_RELATIVE_PATH = `${TEST_TENANT_DIR}/fixture.docx`;
const TEST_FILE_CONTENT = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('signed-download-fixture')]);

describe('GET /files/signed-download', () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(STORAGE_ROOT, TEST_TENANT_DIR), { recursive: true });
    await fs.writeFile(path.join(STORAGE_ROOT, TEST_FILE_RELATIVE_PATH), TEST_FILE_CONTENT);
  });

  afterAll(async () => {
    await fs.rm(path.join(STORAGE_ROOT, TEST_TENANT_DIR), { recursive: true, force: true });
  });

  it('rejects a missing token', async () => {
    const response = await request(app).get('/files/signed-download');
    expect(response.status).toBe(400);
  });

  it('rejects an invalid token', async () => {
    const response = await request(app).get('/files/signed-download?token=not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('streams the file for a valid token', async () => {
    const token = signDownloadToken(TEST_FILE_RELATIVE_PATH);
    const response = await request(app)
      .get(`/files/signed-download?token=${token}`)
      .buffer(true)
      .parse((res, callback) => {
        res.setEncoding('binary');
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => callback(null, Buffer.from(data, 'binary')));
      });
    expect(response.status).toBe(200);
    expect(response.body.toString()).toContain('signed-download-fixture');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest tests/signedDownload.test.js`
Expected: FAIL — route not found.

- [ ] **Step 7: Write `backend/src/routes/files.js`**

```js
const express = require('express');
const path = require('path');
const AppError = require('../utils/AppError');
const { verifyDownloadToken } = require('../utils/downloadToken');
const { STORAGE_ROOT } = require('../services/fileStorageService');

const router = express.Router();

router.get('/signed-download', (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      throw new AppError(400, 'token is required');
    }
    const { filePath } = verifyDownloadToken(token);
    res.sendFile(path.join(STORAGE_ROOT, filePath));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 8: Mount the router in `backend/src/app.js`**

Add with the other route imports:
```js
const filesRouter = require('./routes/files');
```
Add with the other top-level mounts:
```js
app.use('/files', filesRouter);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx jest tests/signedDownload.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 10: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add backend/src/utils/downloadToken.js backend/src/routes/files.js backend/src/app.js backend/tests/downloadToken.test.js backend/tests/signedDownload.test.js
git commit -m "feat: add signed short-lived download tokens and endpoint"
```

---

## Task 3: Refactor version-saving into buffer-based shared functions

**Files:**
- Modify: `backend/src/services/templateFileService.js`
- Modify: `backend/src/services/workflowInstanceService.js`
- Test: `backend/tests/templateFiles.test.js`, `backend/tests/instances.versions.test.js` run unchanged (regression check, no new test file)

**Interfaces:**
- Produces: `saveTemplateFileVersionBuffer(tenantId, templateFileId, uploadedBy, buffer, extension) -> Promise<version>` and `saveInstanceVersionBuffer(tenantId, instanceId, uploadedBy, buffer, extension) -> Promise<version>`, plus `getCurrentFileInfo(tenantId, instanceId) -> Promise<{ relativePath, versionLabel }>` (the piece `getCurrentFilePath` already computed internally, now reusable). Task 4's `documentEditingService.js` and Task 5's callback routes call all three. `addTemplateFileVersion`/`addInstanceVersion`'s existing behavior and response shape are unchanged — this is a pure extraction.

- [ ] **Step 1: Refactor `backend/src/services/templateFileService.js`**

Replace `addTemplateFileVersion`'s body from the `assertAllowedUpload` line onward, and add the new exported function:

```js
async function saveTemplateFileVersionBuffer(tenantId, templateFileId, uploadedBy, buffer, extension) {
  const latestVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, template_file_id: templateFileId })
    .max('version_number as max')
    .first();
  const nextVersionNumber = (latestVersion && latestVersion.max ? latestVersion.max : 0) + 1;

  const relativePath = await saveUploadedFile(tenantId, buffer, extension);

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

async function addTemplateFileVersion(tenantId, templateFileId, uploadedBy, file) {
  assertUuid(templateFileId, 'templateFileId');
  const templateFile = await db('template_files').where({ tenant_id: tenantId, id: templateFileId }).first();
  if (!templateFile) {
    throw new AppError(404, 'Template file not found');
  }

  assertAllowedUpload(file, ALLOWED_TEMPLATE_EXTENSIONS, MAX_TEMPLATE_UPLOAD_BYTES);
  const extension = file.originalname.split('.').pop().toLowerCase();
  return saveTemplateFileVersionBuffer(tenantId, templateFileId, uploadedBy, file.buffer, extension);
}
```

Update `module.exports`:
```js
module.exports = {
  createTemplateFile,
  listTemplateFiles,
  getTemplateFile,
  addTemplateFileVersion,
  saveTemplateFileVersionBuffer,
};
```

- [ ] **Step 2: Run the existing template files tests to confirm the refactor didn't change behavior**

Run: `npx jest tests/templateFiles.test.js`
Expected: PASS, all 5 tests green (unchanged from before this task).

- [ ] **Step 3: Refactor `backend/src/services/workflowInstanceService.js`**

Replace `addInstanceVersion`'s body from `assertAllowedUpload` onward, add `saveInstanceVersionBuffer`, and replace `getCurrentFilePath`'s body with a call to a new `getCurrentFileInfo`:

```js
async function saveInstanceVersionBuffer(tenantId, instanceId, uploadedBy, buffer, extension) {
  const latestVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .max('version_number as max')
    .first();
  const nextVersionNumber = (latestVersion && latestVersion.max ? latestVersion.max : 0) + 1;

  const relativePath = await saveUploadedFile(tenantId, buffer, extension);

  const [version] = await db('instance_versions')
    .insert({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      version_number: nextVersionNumber,
      file_path: relativePath,
      uploaded_by: uploadedBy,
    })
    .returning('*');

  return version;
}

async function addInstanceVersion(tenantId, userId, instanceId, file) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances accept new versions');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }

  assertAllowedUpload(file, documentType.allowed_extensions, documentType.max_upload_size_bytes);
  const extension = file.originalname.split('.').pop().toLowerCase();
  return saveInstanceVersionBuffer(tenantId, instanceId, userId, file.buffer, extension);
}

async function getCurrentFileInfo(tenantId, instanceId) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);

  const latestInstanceVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('version_number', 'desc')
    .first();

  if (latestInstanceVersion) {
    return { relativePath: latestInstanceVersion.file_path, versionLabel: `iv${latestInstanceVersion.version_number}` };
  }

  const templateVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, id: instance.template_file_version_id })
    .first();
  return { relativePath: templateVersion.file_path, versionLabel: `tv${templateVersion.version_number}` };
}

async function getCurrentFilePath(tenantId, instanceId) {
  const { relativePath } = await getCurrentFileInfo(tenantId, instanceId);
  return path.join(STORAGE_ROOT, relativePath);
}
```

Update `module.exports`:
```js
module.exports = {
  getInstanceDetail,
  startInstance,
  claimInstance,
  addInstanceVersion,
  saveInstanceVersionBuffer,
  getCurrentFileInfo,
  getCurrentFilePath,
  forwardInstance,
  sendBackInstance,
  rejectInstance,
  resubmitInstance,
  reassignInstance,
};
```

- [ ] **Step 4: Run the existing instance tests to confirm the refactor didn't change behavior**

Run: `npx jest tests/instances.versions.test.js tests/instances.startAndGet.test.js tests/instances.forward.test.js`
Expected: PASS, all unchanged from before this task.

- [ ] **Step 5: Run the full suite to confirm nothing else broke, then commit**

Run: `npm test`
Expected: all suites pass.

```bash
cd "d:\Project\Workflow Managment System"
git add backend/src/services/templateFileService.js backend/src/services/workflowInstanceService.js
git commit -m "refactor: extract buffer-based version-save functions shared by upload and editor-callback paths"
```

---

## Task 4: Editor config service and edit-config endpoints

**Files:**
- Create: `backend/src/services/documentEditingService.js`
- Modify: `backend/src/routes/admin/templateFiles.js` (add `GET /:id/edit-config`)
- Modify: `backend/src/routes/instances.js` (add `GET /:id/edit-config`)
- Test: `backend/tests/documentEditingService.test.js`

**Interfaces:**
- Consumes: `signDownloadToken` (Task 2), `getInstanceDetail`, `getCurrentFileInfo` (Task 3), `canAct` (Phase 2 of the backend).
- Produces: `buildTemplateEditConfig(tenantId, templateFileId, adminUserId) -> Promise<signedConfig>`, `buildInstanceEditConfig(tenantId, instanceId, userId) -> Promise<signedConfig>`; `GET /admin/template-files/:id/edit-config`, `GET /instances/:id/edit-config`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/documentEditingService.test.js
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');
const { validateEnv } = require('../src/config/env');

const TENANT_ID = 'ad000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ad000000-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'ad000000-0000-0000-0000-000000000003';
const OUTSIDER_ID = 'ad000000-0000-0000-0000-000000000004';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const assigneeToken = signToken({ sub: ASSIGNEE_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);

describe('edit-config endpoints', () => {
  let templateFileId;
  let instanceId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Editing Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'edit-admin@example.com', password_hash: 'x', is_admin: true },
        { id: ASSIGNEE_ID, tenant_id: TENANT_ID, email: 'edit-assignee@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'edit-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Editable Template' });
    templateFileId = templateFile.body.id;
    await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Editable Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ASSIGNEE_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Editable Doc', templateFileId, workflowTemplateId: workflowTemplate.body.id });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;
  });

  afterAll(async () => {
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

  it('builds a signed, edit-mode config for an admin editing a template file', async () => {
    const response = await request(app)
      .get(`/admin/template-files/${templateFileId}/edit-config`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.editorConfig.mode).toBe('edit');
    expect(response.body.document.fileType).toBe('docx');
    expect(response.body.document.key).toContain(templateFileId);

    const config = validateEnv();
    const decoded = jwt.verify(response.body.token, config.onlyoffice.jwtSecret, { algorithms: ['HS256'] });
    expect(decoded.document.key).toBe(response.body.document.key);
  });

  it('builds an edit-mode config for the stage assignee on their own instance', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/edit-config`)
      .set('Authorization', `Bearer ${assigneeToken}`);
    expect(response.status).toBe(200);
    expect(response.body.editorConfig.mode).toBe('edit');
  });

  it('builds a view-only config for a tenant member who cannot act on the instance', async () => {
    const response = await request(app)
      .get(`/instances/${instanceId}/edit-config`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(response.status).toBe(200);
    expect(response.body.editorConfig.mode).toBe('view');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/documentEditingService.test.js`
Expected: FAIL — routes not found.

- [ ] **Step 3: Write `backend/src/services/documentEditingService.js`**

```js
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { validateEnv } = require('../config/env');
const { assertUuid } = require('../utils/validation');
const { canAct } = require('../utils/workflowAuthorization');
const { signDownloadToken } = require('../utils/downloadToken');
const { getInstanceDetail, getCurrentFileInfo } = require('./workflowInstanceService');

function buildDownloadUrl(relativePath) {
  const config = validateEnv();
  const token = signDownloadToken(relativePath);
  return `${config.onlyoffice.callbackBaseUrl}/files/signed-download?token=${token}`;
}

function signOnlyOfficeConfig(unsignedConfig) {
  const config = validateEnv();
  const token = jwt.sign(unsignedConfig, config.onlyoffice.jwtSecret, { algorithm: 'HS256' });
  return { ...unsignedConfig, token };
}

async function buildTemplateEditConfig(tenantId, templateFileId, adminUserId) {
  assertUuid(templateFileId, 'templateFileId');
  const config = validateEnv();

  const templateFile = await db('template_files').where({ tenant_id: tenantId, id: templateFileId }).first();
  if (!templateFile) {
    throw new AppError(404, 'Template file not found');
  }
  const latestVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, template_file_id: templateFileId })
    .orderBy('version_number', 'desc')
    .first();
  if (!latestVersion) {
    throw new AppError(400, 'This template file has no uploaded versions yet');
  }

  const unsignedConfig = {
    document: {
      fileType: 'docx',
      key: `template-${templateFileId}-${latestVersion.version_number}`,
      title: `${templateFile.name}.docx`,
      url: buildDownloadUrl(latestVersion.file_path),
    },
    editorConfig: {
      mode: 'edit',
      callbackUrl: `${config.onlyoffice.callbackBaseUrl}/files/callback/template-files/${templateFileId}?tenantId=${tenantId}&actorUserId=${adminUserId}`,
      user: { id: adminUserId, name: 'Admin' },
    },
  };

  return signOnlyOfficeConfig(unsignedConfig);
}

async function buildInstanceEditConfig(tenantId, instanceId, userId) {
  const config = validateEnv();
  const { instance, stage, documentType } = await getInstanceDetail(tenantId, instanceId);
  const { relativePath, versionLabel } = await getCurrentFileInfo(tenantId, instanceId);

  const mode = instance.status === 'in_progress' && canAct(stage, instance, userId) ? 'edit' : 'view';

  const unsignedConfig = {
    document: {
      fileType: 'docx',
      key: `instance-${instanceId}-${versionLabel}`,
      title: `${documentType.name}.docx`,
      url: buildDownloadUrl(relativePath),
    },
    editorConfig: {
      mode,
      callbackUrl: `${config.onlyoffice.callbackBaseUrl}/files/callback/instances/${instanceId}?tenantId=${tenantId}&actorUserId=${userId}`,
      user: { id: userId, name: 'User' },
    },
  };

  return signOnlyOfficeConfig(unsignedConfig);
}

module.exports = { buildTemplateEditConfig, buildInstanceEditConfig };
```

- [ ] **Step 4: Add the route to `backend/src/routes/admin/templateFiles.js`**

Add to the imports:
```js
const { buildTemplateEditConfig } = require('../../services/documentEditingService');
```
Add before `module.exports = router;`:
```js
router.get('/:id/edit-config', async (req, res, next) => {
  try {
    const editConfig = await buildTemplateEditConfig(req.user.tenantId, req.params.id, req.user.userId);
    res.status(200).json(editConfig);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Add the route to `backend/src/routes/instances.js`**

Add to the imports:
```js
const { buildInstanceEditConfig } = require('../services/documentEditingService');
```
Add before `module.exports = router;`:
```js
router.get('/:id/edit-config', async (req, res, next) => {
  try {
    const editConfig = await buildInstanceEditConfig(req.user.tenantId, req.params.id, req.user.userId);
    res.status(200).json(editConfig);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/documentEditingService.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 7: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add backend/src/services/documentEditingService.js backend/src/routes/admin/templateFiles.js backend/src/routes/instances.js backend/tests/documentEditingService.test.js
git commit -m "feat: add OnlyOffice editor config service and edit-config endpoints"
```

---

## Task 5: Save-callback endpoint

**Files:**
- Create: `backend/src/routes/filesCallback.js`
- Modify: `backend/src/app.js` (mount the router)
- Test: `backend/tests/filesCallback.test.js`

**Interfaces:**
- Consumes: `saveTemplateFileVersionBuffer` (Task 3), `saveInstanceVersionBuffer` (Task 3), `assertAllowedUpload` (existing), `config.onlyoffice.jwtSecret`.
- Produces: `POST /files/callback/template-files/:id`, `POST /files/callback/instances/:id`. No exports — this is the phase's terminal integration point.

- [ ] **Step 1: Write the failing test**

This test spins up a tiny local HTTP server to stand in for the Document Server's ephemeral "here's the saved file" URL, since no real Document Server is available in this environment.

```js
// backend/tests/filesCallback.test.js
const http = require('http');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { validateEnv } = require('../src/config/env');

const TENANT_ID = 'ae000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ae000000-0000-0000-0000-000000000002';
const ASSIGNEE_ID = 'ae000000-0000-0000-0000-000000000003';
const validDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
const savedDocxBuffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('saved-by-editor')]);

function signOnlyOfficeJwt(payload) {
  const config = validateEnv();
  return jwt.sign(payload, config.onlyoffice.jwtSecret, { algorithm: 'HS256' });
}

async function startFixtureServer(buffer) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end(buffer);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/saved.docx` });
    });
  });
}

describe('POST /files/callback', () => {
  let templateFileId;
  let instanceId;
  let fixtureServer;
  let fixtureUrl;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Callback Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'cb-admin@example.com', password_hash: 'x', is_admin: true },
        { id: ASSIGNEE_ID, tenant_id: TENANT_ID, email: 'cb-assignee@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();

    const adminToken = require('../src/utils/jwt').signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
    const assigneeToken = require('../src/utils/jwt').signToken({
      sub: ASSIGNEE_ID,
      tenant_id: TENANT_ID,
      is_admin: false,
    });

    const templateFile = await request(app)
      .post('/admin/template-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Callback Template' });
    templateFileId = templateFile.body.id;
    await request(app)
      .post(`/admin/template-files/${templateFileId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', validDocxBuffer, 'v1.docx');

    const workflowTemplate = await request(app)
      .post('/admin/workflow-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Callback Approval' });
    await request(app)
      .post(`/admin/workflow-templates/${workflowTemplate.body.id}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stageOrder: 1, name: 'Draft', assigneeType: 'user', assigneeUserId: ASSIGNEE_ID });

    const documentType = await request(app)
      .post('/admin/document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Callback Doc', templateFileId, workflowTemplateId: workflowTemplate.body.id });

    const started = await request(app)
      .post('/instances')
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ documentTypeId: documentType.body.id });
    instanceId = started.body.id;
  });

  beforeEach(async () => {
    ({ server: fixtureServer, url: fixtureUrl } = await startFixtureServer(savedDocxBuffer));
  });

  afterEach(async () => {
    await new Promise((resolve) => fixtureServer.close(resolve));
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

  it('rejects a callback with no valid OnlyOffice token', async () => {
    const response = await request(app)
      .post(`/files/callback/template-files/${templateFileId}?tenantId=${TENANT_ID}&actorUserId=${ADMIN_ID}`)
      .send({ status: 2, url: fixtureUrl });
    expect(response.status).toBe(403);
  });

  it('creates a new template file version on a valid save callback', async () => {
    const token = signOnlyOfficeJwt({ status: 2, url: fixtureUrl });
    const response = await request(app)
      .post(`/files/callback/template-files/${templateFileId}?tenantId=${TENANT_ID}&actorUserId=${ADMIN_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 2, url: fixtureUrl });

    expect(response.status).toBe(200);
    expect(response.body.error).toBe(0);

    const versions = await db('template_file_versions').where({ tenant_id: TENANT_ID, template_file_id: templateFileId });
    expect(versions).toHaveLength(2);
    expect(versions.some((v) => v.uploaded_by === ADMIN_ID && v.version_number === 2)).toBe(true);
  });

  it('creates a new instance version on a valid save callback', async () => {
    const token = signOnlyOfficeJwt({ status: 2, url: fixtureUrl });
    const response = await request(app)
      .post(`/files/callback/instances/${instanceId}?tenantId=${TENANT_ID}&actorUserId=${ASSIGNEE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 2, url: fixtureUrl });

    expect(response.status).toBe(200);
    expect(response.body.error).toBe(0);

    const versions = await db('instance_versions').where({ tenant_id: TENANT_ID, workflow_instance_id: instanceId });
    expect(versions).toHaveLength(1);
    expect(versions[0].uploaded_by).toBe(ASSIGNEE_ID);
  });

  it('does nothing for a non-save status (e.g. still editing)', async () => {
    const token = signOnlyOfficeJwt({ status: 1 });
    const response = await request(app)
      .post(`/files/callback/instances/${instanceId}?tenantId=${TENANT_ID}&actorUserId=${ASSIGNEE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 1 });

    expect(response.status).toBe(200);
    expect(response.body.error).toBe(0);

    const versions = await db('instance_versions').where({ tenant_id: TENANT_ID, workflow_instance_id: instanceId });
    expect(versions).toHaveLength(1); // unchanged from the previous test
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/filesCallback.test.js`
Expected: FAIL — routes not found.

- [ ] **Step 3: Write `backend/src/routes/filesCallback.js`**

```js
const express = require('express');
const jwt = require('jsonwebtoken');
const { validateEnv } = require('../config/env');
const AppError = require('../utils/AppError');
const { assertUuid } = require('../utils/validation');
const { assertAllowedUpload } = require('../utils/fileValidation');
const db = require('../config/db');
const { saveTemplateFileVersionBuffer } = require('../services/templateFileService');
const { saveInstanceVersionBuffer } = require('../services/workflowInstanceService');

const router = express.Router();

const SAVE_STATUSES = new Set([2, 6]);
const MAX_EDITOR_SAVE_BYTES = 10 * 1024 * 1024;

function verifyOnlyOfficeRequest(req) {
  const config = validateEnv();
  const authHeader = req.headers.authorization || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch ? bearerMatch[1] : req.body && req.body.token;

  if (!token) {
    throw new AppError(403, 'Missing OnlyOffice callback token');
  }
  try {
    jwt.verify(token, config.onlyoffice.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    throw new AppError(403, 'Invalid OnlyOffice callback token');
  }
}

async function downloadSavedBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError(502, 'Failed to download saved document from the editor');
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function assertActorBelongsToTenant(tenantId, actorUserId) {
  assertUuid(tenantId, 'tenantId');
  assertUuid(actorUserId, 'actorUserId');
  const actor = await db('users').where({ tenant_id: tenantId, id: actorUserId }).first();
  if (!actor) {
    throw new AppError(400, 'actorUserId does not belong to this tenant');
  }
}

router.post('/template-files/:id', async (req, res, next) => {
  try {
    verifyOnlyOfficeRequest(req);
    const { status, url } = req.body;

    if (SAVE_STATUSES.has(status)) {
      const { tenantId, actorUserId } = req.query;
      await assertActorBelongsToTenant(tenantId, actorUserId);

      const buffer = await downloadSavedBuffer(url);
      assertAllowedUpload({ originalname: 'edited.docx', size: buffer.length, buffer }, ['docx'], MAX_EDITOR_SAVE_BYTES);
      await saveTemplateFileVersionBuffer(tenantId, req.params.id, actorUserId, buffer, 'docx');
    }

    res.status(200).json({ error: 0 });
  } catch (err) {
    next(err);
  }
});

router.post('/instances/:id', async (req, res, next) => {
  try {
    verifyOnlyOfficeRequest(req);
    const { status, url } = req.body;

    if (SAVE_STATUSES.has(status)) {
      const { tenantId, actorUserId } = req.query;
      await assertActorBelongsToTenant(tenantId, actorUserId);

      const buffer = await downloadSavedBuffer(url);
      assertAllowedUpload({ originalname: 'edited.docx', size: buffer.length, buffer }, ['docx'], MAX_EDITOR_SAVE_BYTES);
      await saveInstanceVersionBuffer(tenantId, req.params.id, actorUserId, buffer, 'docx');
    }

    res.status(200).json({ error: 0 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount the router in `backend/src/app.js`**

Add with the other route imports:
```js
const filesCallbackRouter = require('./routes/filesCallback');
```
Add with the other top-level mounts:
```js
app.use('/files/callback', filesCallbackRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/filesCallback.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
cd "d:\Project\Workflow Managment System"
git add backend/src/routes/filesCallback.js backend/src/app.js backend/tests/filesCallback.test.js
git commit -m "feat: add OnlyOffice save-callback endpoint"
```

---

## Task 6: End-to-end verification with the real Document Server

**Files:** none created — verification only, plus `PROGRESS.md`.

- [ ] **Step 1: Run the full automated test suite**

Run: `cd "d:\Project\Workflow Managment System\backend" && npm test`
Expected: all suites pass.

- [ ] **Step 2: Pull and start the real OnlyOffice Document Server**

Run:
```bash
docker compose up -d onlyoffice
```
Expected: the image downloads (this is a large image, first pull can take several minutes) and the container reaches a healthy/running state.

- [ ] **Step 3: Verify the Document Server itself is reachable**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8082/welcome/`
Expected: `200`.

- [ ] **Step 4: Verify an edit-config is well-formed and its download URL actually resolves**

With the backend running, fetch a real edit-config, then use its `document.url` to confirm the Document Server (or anyone) can actually download the file through the signed-download endpoint:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@dev.local","password":"ChangeMe123!"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")
TEMPLATE_FILE_ID=$(curl -s http://localhost:3000/admin/template-files -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data', d => console.log(JSON.parse(d)[0].id))")
curl -s http://localhost:3000/admin/template-files/$TEMPLATE_FILE_ID/edit-config -H "Authorization: Bearer $TOKEN"
```
Expected: a JSON object with `document.url`, `document.key`, `editorConfig.callbackUrl`, and `token`. Copy `document.url` and `curl` it directly — expect the raw `.docx` bytes back with `200`.

Full interactive verification (opening the URL in the Document Server's own editor UI, typing a change, saving, and confirming the callback fires) requires the frontend phase's embed component and a real browser — not something this backend-only phase can complete alone. Note this honestly rather than claiming full verification here.

- [ ] **Step 5: Update `PROGRESS.md` and commit**

```bash
cd "d:\Project\Workflow Managment System"
git add PROGRESS.md
git commit -m "docs: update progress log for OnlyOffice backend integration"
```
