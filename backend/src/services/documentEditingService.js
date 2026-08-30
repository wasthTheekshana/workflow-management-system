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

// This token — not the client-facing config.token above — is what actually
// authorizes a save callback for one specific resource. It must never be
// derived from data the browser could resupply (tenantId/actorUserId as
// plain query params, say): anyone who fetches an edit-config already holds
// a validly-signed JWT (config.token, same secret), so without a token that
// is itself scoped to exactly this resource/tenant/actor, that same JWT
// could be replayed straight at the callback endpoint to version-inject
// arbitrary content into any resource. Minting this only for an edit-mode
// session (never for view-mode) also means a viewer can never obtain a
// token that would let them force a save at all.
const CALLBACK_TOKEN_PURPOSE = 'onlyoffice-callback';
const CALLBACK_TOKEN_EXPIRES_IN = '4h';

function buildCallbackUrl(resourceType, resourceId, tenantId, actorUserId) {
  const config = validateEnv();
  const callbackToken = jwt.sign(
    { purpose: CALLBACK_TOKEN_PURPOSE, resourceType, resourceId, tenantId, actorUserId },
    config.onlyoffice.jwtSecret,
    { algorithm: 'HS256', expiresIn: CALLBACK_TOKEN_EXPIRES_IN },
  );
  return `${config.onlyoffice.callbackBaseUrl}/files/callback/${resourceType}/${resourceId}?callbackToken=${callbackToken}`;
}

async function buildTemplateEditConfig(tenantId, templateFileId, adminUserId) {
  assertUuid(templateFileId, 'templateFileId');

  const templateFile = await db('template_files').where({ tenant_id: tenantId, id: templateFileId }).first();
  if (!templateFile) {
    throw new AppError(404, 'Template file not found');
  }
  if (templateFile.content_format !== 'docx') {
    throw new AppError(400, 'This template is not a docx template; use the rich-text editor instead');
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
      callbackUrl: buildCallbackUrl('template-files', templateFileId, tenantId, adminUserId),
      user: { id: adminUserId, name: 'Admin' },
    },
  };

  return signOnlyOfficeConfig(unsignedConfig);
}

async function buildInstanceEditConfig(tenantId, instanceId, userId) {
  const { instance, stage, documentType } = await getInstanceDetail(tenantId, instanceId);
  const { relativePath, versionLabel } = await getCurrentFileInfo(tenantId, instanceId);

  const mode = instance.status === 'in_progress' && canAct(stage, instance, userId) ? 'edit' : 'view';

  const editorConfig = {
    mode,
    user: { id: userId, name: 'User' },
  };
  // Only an edit-mode session ever gets a callback token — a viewer must
  // never be able to force a save, and without a token scoped to this
  // resource there is nothing for a forged callback to present.
  if (mode === 'edit') {
    editorConfig.callbackUrl = buildCallbackUrl('instances', instanceId, tenantId, userId);
  }

  const unsignedConfig = {
    document: {
      fileType: 'docx',
      key: `instance-${instanceId}-${versionLabel}`,
      title: `${documentType.name}.docx`,
      url: buildDownloadUrl(relativePath),
    },
    editorConfig,
  };

  return signOnlyOfficeConfig(unsignedConfig);
}

module.exports = { buildTemplateEditConfig, buildInstanceEditConfig };
