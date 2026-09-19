const path = require('path');
const fs = require('fs/promises');
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid } = require('../utils/validation');
const { saveUploadedFile, STORAGE_ROOT } = require('./fileStorageService');

const ALLOWED_ATTACHMENT_EXTENSIONS = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'doc',
  'xls',
  'ppt',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'txt',
  'csv',
  'zip',
];
const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

async function requireInstance(tenantId, instanceId) {
  assertUuid(instanceId, 'instanceId');
  const instance = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .first();
  if (!instance) {
    throw new AppError(404, 'Workflow instance not found');
  }
  return instance;
}

async function listAttachments(tenantId, instanceId) {
  await requireInstance(tenantId, instanceId);

  return db('instance_attachments')
    .leftJoin('users', 'users.id', 'instance_attachments.uploaded_by')
    .where({ 'instance_attachments.tenant_id': tenantId, 'instance_attachments.workflow_instance_id': instanceId })
    .select(
      'instance_attachments.*',
      'users.email as uploader_email',
      'users.full_name as uploader_name',
    )
    .orderBy('instance_attachments.created_at', 'asc');
}

async function addAttachment(tenantId, userId, instanceId, file) {
  const instance = await requireInstance(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances accept new attachments');
  }

  if (!file) {
    throw new AppError(400, 'File is required');
  }

  const parts = file.originalname.split('.');
  const extension = parts.length > 1 ? parts.pop().toLowerCase() : '';

  if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(extension)) {
    throw new AppError(
      400,
      `File extension .${extension || 'unknown'} is not allowed. Allowed types: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}`,
    );
  }

  const size = file.size || (file.buffer ? file.buffer.length : 0);
  if (size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new AppError(400, `File exceeds the maximum allowed size of 15MB`);
  }

  const relativePath = await saveUploadedFile(tenantId, file.buffer, extension);

  const [attachment] = await db('instance_attachments')
    .insert({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      file_name: file.originalname,
      file_path: relativePath,
      file_size_bytes: size,
      mime_type: file.mimetype || null,
      uploaded_by: userId,
    })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'add_attachment',
    from_stage_order: instance.current_stage_order,
    to_stage_order: instance.current_stage_order,
    actor_id: userId,
    comment: file.originalname,
  });

  return attachment;
}

async function getAttachmentFile(tenantId, instanceId, attachmentId) {
  await requireInstance(tenantId, instanceId);
  assertUuid(attachmentId, 'attachmentId');

  const attachment = await db('instance_attachments')
    .where({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      id: attachmentId,
    })
    .first();

  if (!attachment) {
    throw new AppError(404, 'Attachment not found');
  }

  const absolutePath = path.resolve(STORAGE_ROOT, attachment.file_path);
  return { attachment, absolutePath };
}

async function deleteAttachment(tenantId, userId, isAdmin, instanceId, attachmentId) {
  const instance = await requireInstance(tenantId, instanceId);
  assertUuid(attachmentId, 'attachmentId');

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Attachments cannot be deleted from closed workflows');
  }

  const attachment = await db('instance_attachments')
    .where({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      id: attachmentId,
    })
    .first();

  if (!attachment) {
    throw new AppError(404, 'Attachment not found');
  }

  if (attachment.uploaded_by !== userId && !isAdmin) {
    throw new AppError(403, 'Only the uploader or an admin can delete this attachment');
  }

  await db('instance_attachments')
    .where({ tenant_id: tenantId, id: attachmentId })
    .del();

  const absolutePath = path.resolve(STORAGE_ROOT, attachment.file_path);
  try {
    await fs.unlink(absolutePath);
  } catch {
    // Ignore file unlink failure if already removed
  }

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'delete_attachment',
    from_stage_order: instance.current_stage_order,
    to_stage_order: instance.current_stage_order,
    actor_id: userId,
    comment: attachment.file_name,
  });

  return { success: true };
}

module.exports = {
  listAttachments,
  addAttachment,
  getAttachmentFile,
  deleteAttachment,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_SIZE_BYTES,
};

