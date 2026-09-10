const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');

const DEFAULT_ALLOWED_EXTENSIONS = ['docx'];
const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const WORKFLOW_MODES = ['predefined', 'adhoc'];

async function assertBelongsToTenant(tenantId, table, id, label) {
  assertUuid(id, label);
  const row = await db(table).where({ tenant_id: tenantId, id }).first();
  if (!row) {
    throw new AppError(400, `${label} does not belong to this tenant`);
  }
}

async function createDocumentType(tenantId, input) {
  const { name, templateFileId, workflowMode, workflowTemplateId, allowedExtensions, maxUploadSizeBytes } = input;
  assertRequiredString(name, 'name');
  await assertBelongsToTenant(tenantId, 'template_files', templateFileId, 'templateFileId');

  const mode = workflowMode === undefined ? 'predefined' : workflowMode;
  if (!WORKFLOW_MODES.includes(mode)) {
    throw new AppError(400, `workflowMode must be one of: ${WORKFLOW_MODES.join(', ')}`);
  }

  let resolvedWorkflowTemplateId = null;
  if (mode === 'predefined') {
    await assertBelongsToTenant(tenantId, 'workflow_templates', workflowTemplateId, 'workflowTemplateId');
    resolvedWorkflowTemplateId = workflowTemplateId;
  } else if (workflowTemplateId !== undefined && workflowTemplateId !== null) {
    throw new AppError(400, 'workflowTemplateId must not be provided when workflowMode is "adhoc"');
  }

  const [documentType] = await db('document_types')
    .insert({
      tenant_id: tenantId,
      name,
      template_file_id: templateFileId,
      workflow_mode: mode,
      workflow_template_id: resolvedWorkflowTemplateId,
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
