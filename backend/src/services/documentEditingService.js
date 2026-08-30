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
