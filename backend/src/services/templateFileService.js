const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');
const { assertAllowedUpload } = require('../utils/fileValidation');
const { saveUploadedFile } = require('./fileStorageService');

const ALLOWED_TEMPLATE_EXTENSIONS = ['docx'];
const MAX_TEMPLATE_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_FORMATS = ['docx', 'richtext'];

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
  if (templateFile.content_format !== 'docx') {
    throw new AppError(400, 'This template does not accept file uploads; it is a rich-text template');
  }

  assertAllowedUpload(file, ALLOWED_TEMPLATE_EXTENSIONS, MAX_TEMPLATE_UPLOAD_BYTES);
  const extension = file.originalname.split('.').pop().toLowerCase();
  return saveTemplateFileVersionBuffer(tenantId, templateFileId, uploadedBy, file.buffer, extension);
}

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

module.exports = {
  createTemplateFile,
  listTemplateFiles,
  getTemplateFile,
  addTemplateFileVersion,
  addTemplateFileContentVersion,
  saveTemplateFileVersionBuffer,
};
