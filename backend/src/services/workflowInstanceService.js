const path = require('path');
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid } = require('../utils/validation');
const { canAct } = require('../utils/workflowAuthorization');
const { assertAllowedUpload } = require('../utils/fileValidation');
const { saveUploadedFile, STORAGE_ROOT } = require('./fileStorageService');

async function getInstanceDetail(tenantId, instanceId) {
  assertUuid(instanceId, 'instanceId');
  const instance = await db('workflow_instances').where({ tenant_id: tenantId, id: instanceId }).first();
  if (!instance) {
    throw new AppError(404, 'Workflow instance not found');
  }

  const documentType = await db('document_types')
    .where({ tenant_id: tenantId, id: instance.document_type_id })
    .first();

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

async function addInstanceVersion(tenantId, userId, instanceId, file) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances accept new versions');
  }
  if (!canAct(stage, instance, userId)) {
    throw new AppError(403, 'You are not authorized to act on this instance right now');
  }

  assertAllowedUpload(file, documentType.allowed_extensions, documentType.max_upload_size_bytes);

  const latestVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .max('version_number as max')
    .first();
  const nextVersionNumber = (latestVersion && latestVersion.max ? latestVersion.max : 0) + 1;

  const extension = file.originalname.split('.').pop().toLowerCase();
  const relativePath = await saveUploadedFile(tenantId, file.buffer, extension);

  const [version] = await db('instance_versions')
    .insert({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      version_number: nextVersionNumber,
      file_path: relativePath,
      uploaded_by: userId,
    })
    .returning('*');

  return version;
}

async function getCurrentFilePath(tenantId, instanceId) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);

  const latestInstanceVersion = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('version_number', 'desc')
    .first();

  const relativePath = latestInstanceVersion
    ? latestInstanceVersion.file_path
    : (
        await db('template_file_versions')
          .where({ tenant_id: tenantId, id: instance.template_file_version_id })
          .first()
      ).file_path;

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

  return updated;
}

module.exports = {
  getInstanceDetail,
  startInstance,
  claimInstance,
  addInstanceVersion,
  getCurrentFilePath,
  forwardInstance,
};
