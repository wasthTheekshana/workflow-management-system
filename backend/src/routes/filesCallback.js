const express = require('express');
const jwt = require('jsonwebtoken');
const { validateEnv } = require('../config/env');
const AppError = require('../utils/AppError');
const { assertAllowedUpload } = require('../utils/fileValidation');
const db = require('../config/db');
const { saveTemplateFileVersionBuffer } = require('../services/templateFileService');
const { saveInstanceVersionBuffer } = require('../services/workflowInstanceService');

const router = express.Router();

const SAVE_STATUSES = new Set([2, 6]);
const MAX_EDITOR_SAVE_BYTES = 10 * 1024 * 1024;
const CALLBACK_TOKEN_PURPOSE = 'onlyoffice-callback';

function extractOnlyOfficeToken(req) {
  const authHeader = req.headers.authorization || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1];
  if (req.body && req.body.token) return req.body.token;
  return null;
}

// Proves this request's status/url genuinely came from our configured
// Document Server relaying a save event — not a browser fabricating a
// request directly. The verified payload, not req.body, is the source of
// truth from here on: if the Document Server's own signature covers the
// callback body (which it does), trusting req.body separately would let a
// tampered body ride along with an otherwise-valid, unrelated signature.
function verifyOnlyOfficeRelay(req) {
  const config = validateEnv();
  const token = extractOnlyOfficeToken(req);
  if (!token) {
    throw new AppError(403, 'Missing OnlyOffice callback token');
  }
  try {
    return jwt.verify(token, config.onlyoffice.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    throw new AppError(403, 'Invalid OnlyOffice callback token');
  }
}

// Proves this specific callback is authorized for this specific resource —
// this token is only ever minted by documentEditingService for an edit-mode
// session the caller was already allowed to open, and only ever for that
// exact resourceType/resourceId/tenantId/actorUserId. Without this check,
// the relay signature alone (above) isn't enough: anyone who fetched their
// own edit-config already holds a validly-signed JWT for the same secret and
// could otherwise replay it against any tenantId/actorUserId/resource they
// choose via the query string.
function verifyCallbackAuthorization(req, expectedResourceType) {
  const config = validateEnv();
  const { callbackToken } = req.query;
  if (!callbackToken) {
    throw new AppError(403, 'Missing callback authorization token');
  }
  let payload;
  try {
    payload = jwt.verify(callbackToken, config.onlyoffice.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    throw new AppError(403, 'Invalid or expired callback authorization token');
  }
  if (
    payload.purpose !== CALLBACK_TOKEN_PURPOSE ||
    payload.resourceType !== expectedResourceType ||
    payload.resourceId !== req.params.id
  ) {
    throw new AppError(403, 'Callback authorization token does not match this resource');
  }
  return { tenantId: payload.tenantId, actorUserId: payload.actorUserId };
}

function isTrustedDocumentServerHost(url) {
  const config = validateEnv();
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return false;
  }
  // Compare hostname only, not the full host:port — the Document Server may
  // legitimately serve its saved-file URLs on a different internal port
  // than the one the browser uses to reach it. This still blocks the actual
  // SSRF target (an arbitrary attacker-chosen host), which is the property
  // that matters.
  const trustedHostnames = new Set([
    new URL(config.onlyoffice.documentServerUrl).hostname,
    new URL(config.onlyoffice.callbackBaseUrl).hostname,
  ]);
  return trustedHostnames.has(parsed.hostname);
}

async function downloadSavedBuffer(url) {
  if (!isTrustedDocumentServerHost(url)) {
    throw new AppError(400, 'Refusing to download from an untrusted host');
  }
  // Never follow a redirect blindly — a trusted host that 3xx's elsewhere
  // (openly or via compromise) is exactly how a host allow-list gets
  // bypassed to reach an internal service or a cloud metadata endpoint.
  const response = await fetch(url, { redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    throw new AppError(502, 'Refusing to follow a redirect when downloading the saved document');
  }
  if (!response.ok) {
    throw new AppError(502, 'Failed to download saved document from the editor');
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function assertActorBelongsToTenant(tenantId, actorUserId) {
  const actor = await db('users').where({ tenant_id: tenantId, id: actorUserId }).first();
  if (!actor) {
    throw new AppError(400, 'actorUserId does not belong to this tenant');
  }
}

router.post('/template-files/:id', async (req, res, next) => {
  try {
    const relayPayload = verifyOnlyOfficeRelay(req);
    const { tenantId, actorUserId } = verifyCallbackAuthorization(req, 'template-files');
    const { status, url } = relayPayload;

    if (SAVE_STATUSES.has(status)) {
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
    const relayPayload = verifyOnlyOfficeRelay(req);
    const { tenantId, actorUserId } = verifyCallbackAuthorization(req, 'instances');
    const { status, url } = relayPayload;

    if (SAVE_STATUSES.has(status)) {
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
