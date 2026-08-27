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
