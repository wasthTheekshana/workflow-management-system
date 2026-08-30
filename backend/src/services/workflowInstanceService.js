const path = require('path');
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid } = require('../utils/validation');
const { canAct } = require('../utils/workflowAuthorization');
const { assertAllowedUpload } = require('../utils/fileValidation');
const { saveUploadedFile, STORAGE_ROOT } = require('./fileStorageService');
const { notifyStage, notifyUser } = require('./notificationService');

async function getInstanceDetail(tenantId, instanceId) {
  assertUuid(instanceId, 'instanceId');
  const instance = await db('workflow_instances').where({ tenant_id: tenantId, id: instanceId }).first();
  if (!instance) {
    throw new AppError(404, 'Workflow instance not found');
  }

  const documentType = await db('document_types')
    .where({ tenant_id: tenantId, id: instance.document_type_id })
    .first();

  const templateFile = await db('template_files')
    .where({ tenant_id: tenantId, id: documentType.template_file_id })
    .first();
  documentType.content_format = templateFile.content_format;

  const stage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: documentType.workflow_template_id,
      stage_order: instance.current_stage_order,
    })
    .first();

  return { instance, documentType, stage };
}

async function startInstance(tenantId, userId, documentTypeId) {
  assertUuid(documentTypeId, 'documentTypeId');
  const documentType = await db('document_types').where({ tenant_id: tenantId, id: documentTypeId }).first();
  if (!documentType) {
    throw new AppError(400, 'documentTypeId does not belong to this tenant');
  }

  const latestTemplateVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, template_file_id: documentType.template_file_id })
    .orderBy('version_number', 'desc')
    .first();
  if (!latestTemplateVersion) {
    throw new AppError(400, 'The linked template file has no uploaded versions yet');
  }

  const firstStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: documentType.workflow_template_id, stage_order: 1 })
    .first();
  if (!firstStage) {
    throw new AppError(400, 'The linked workflow template has no stages configured yet');
  }

  const [instance] = await db('workflow_instances')
    .insert({
      tenant_id: tenantId,
      document_type_id: documentTypeId,
      template_file_version_id: latestTemplateVersion.id,
      current_stage_order: 1,
      status: 'in_progress',
      created_by: userId,
    })
    .returning('*');

  await notifyStage(tenantId, instance.id, 'assigned', firstStage, {
    documentTypeName: documentType.name,
    stageName: firstStage.name,
  });

  return instance;
}

async function claimInstance(tenantId, userId, instanceId) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be claimed');
  }
  if (stage.assignee_type !== 'role') {
    throw new AppError(400, 'The current stage is not role-assigned; claiming does not apply');
  }
  if (instance.claimed_by) {
    throw new AppError(400, 'This instance has already been claimed');
  }

  const hasRole = await db('user_roles')
    .where({ tenant_id: tenantId, user_id: userId, role_id: stage.assignee_role_id })
    .first();
  if (!hasRole) {
    throw new AppError(403, 'You do not hold the role assigned to this stage');
  }

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ claimed_by: userId })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'claim',
    from_stage_order: instance.current_stage_order,
    to_stage_order: instance.current_stage_order,
    actor_id: userId,
  });

  return updated;
}

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
  if (documentType.content_format !== 'docx') {
    throw new AppError(400, 'This instance does not accept file uploads; it is a rich-text document');
  }

  assertAllowedUpload(file, documentType.allowed_extensions, documentType.max_upload_size_bytes);
  const extension = file.originalname.split('.').pop().toLowerCase();
  return saveInstanceVersionBuffer(tenantId, instanceId, userId, file.buffer, extension);
}

async function addInstanceContentVersion(tenantId, userId, instanceId, content) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances accept new versions');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }
  if (documentType.content_format !== 'richtext') {
    throw new AppError(400, 'This instance is not a rich-text document');
  }
  if (typeof content !== 'object' || content === null) {
    throw new AppError(400, 'content must be a JSON object');
  }

  const latestVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .max('version_number as max')
    .first();
  const nextVersionNumber = (latestVersion && latestVersion.max ? latestVersion.max : 0) + 1;

  const [version] = await db('instance_versions')
    .insert({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      version_number: nextVersionNumber,
      content: JSON.stringify(content),
      uploaded_by: userId,
    })
    .returning('*');

  return version;
}

async function getCurrentContent(tenantId, instanceId) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);

  const latestInstanceVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('version_number', 'desc')
    .first();

  if (latestInstanceVersion) {
    return latestInstanceVersion.content;
  }

  const templateVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, id: instance.template_file_version_id })
    .first();
  return templateVersion.content;
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

async function forwardInstance(tenantId, userId, instanceId, comment) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be forwarded');
  }
  if (!stage.allowed_actions.includes('forward')) {
    throw new AppError(400, 'The current stage does not allow forwarding');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }

  const nextStage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: documentType.workflow_template_id,
      stage_order: instance.current_stage_order + 1,
    })
    .first();

  const updates = nextStage
    ? { current_stage_order: nextStage.stage_order, claimed_by: null }
    : { status: 'completed' };

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update(updates)
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'forward',
    from_stage_order: instance.current_stage_order,
    to_stage_order: nextStage ? nextStage.stage_order : instance.current_stage_order,
    actor_id: userId,
    comment: comment || null,
  });

  if (nextStage) {
    await notifyStage(tenantId, instanceId, 'forwarded', nextStage, {
      documentTypeName: documentType.name,
      stageName: nextStage.name,
    });
  } else {
    await notifyUser(tenantId, instanceId, 'completed', instance.created_by, {
      documentTypeName: documentType.name,
    });
  }

  return updated;
}

async function sendBackInstance(tenantId, userId, instanceId, comment) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be sent back');
  }
  if (!stage.allowed_actions.includes('send_back')) {
    throw new AppError(400, 'The current stage does not allow sending back');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }
  if (instance.current_stage_order <= 1) {
    throw new AppError(400, 'Cannot send back from the first stage');
  }

  const targetStageOrder = instance.current_stage_order - 1;

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ current_stage_order: targetStageOrder, claimed_by: null })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'send_back',
    from_stage_order: instance.current_stage_order,
    to_stage_order: targetStageOrder,
    actor_id: userId,
    comment: comment || null,
  });

  const targetStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: documentType.workflow_template_id, stage_order: targetStageOrder })
    .first();
  await notifyStage(tenantId, instanceId, 'sent_back', targetStage, {
    documentTypeName: documentType.name,
    stageName: targetStage.name,
  });

  return updated;
}

async function rejectInstance(tenantId, userId, instanceId, comment) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be rejected');
  }
  if (!stage.allowed_actions.includes('reject')) {
    throw new AppError(400, 'The current stage does not allow rejecting');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ status: 'rejected' })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'reject',
    from_stage_order: instance.current_stage_order,
    to_stage_order: null,
    actor_id: userId,
    comment: comment || null,
  });

  await notifyUser(tenantId, instanceId, 'rejected', instance.created_by, {
    documentTypeName: documentType.name,
    comment,
  });

  return updated;
}

async function resubmitInstance(tenantId, userId, instanceId) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'rejected') {
    throw new AppError(400, 'Only rejected instances can be resubmitted');
  }
  if (instance.created_by !== userId) {
    throw new AppError(403, 'Only the original submitter can resubmit this instance');
  }

  const [newInstance] = await db('workflow_instances')
    .insert({
      tenant_id: tenantId,
      document_type_id: instance.document_type_id,
      template_file_version_id: instance.template_file_version_id,
      current_stage_order: 1,
      status: 'in_progress',
      created_by: userId,
    })
    .returning('*');

  const lastVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instance.id })
    .orderBy('version_number', 'desc')
    .first();

  if (lastVersion) {
    await db('instance_versions').insert({
      tenant_id: tenantId,
      workflow_instance_id: newInstance.id,
      version_number: 1,
      file_path: lastVersion.file_path,
      uploaded_by: lastVersion.uploaded_by,
    });
  }

  return newInstance;
}

async function reassignInstance(tenantId, adminId, instanceId, targetUserId, comment) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be reassigned');
  }

  assertUuid(targetUserId, 'userId');
  const targetUser = await db('users').where({ tenant_id: tenantId, id: targetUserId }).first();
  if (!targetUser) {
    throw new AppError(400, 'userId does not belong to this tenant');
  }

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ claimed_by: targetUserId })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'reassign',
    from_stage_order: instance.current_stage_order,
    to_stage_order: instance.current_stage_order,
    actor_id: adminId,
    comment: comment || null,
  });

  await notifyUser(tenantId, instanceId, 'reassigned', targetUserId, {
    documentTypeName: documentType.name,
    stageName: stage.name,
  });

  return updated;
}

module.exports = {
  getInstanceDetail,
  startInstance,
  claimInstance,
  addInstanceVersion,
  addInstanceContentVersion,
  getCurrentContent,
  saveInstanceVersionBuffer,
  getCurrentFileInfo,
  getCurrentFilePath,
  forwardInstance,
  sendBackInstance,
  rejectInstance,
  resubmitInstance,
  reassignInstance,
};
