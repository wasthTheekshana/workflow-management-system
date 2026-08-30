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
