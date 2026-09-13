const path = require('path');
const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');
const { canAct } = require('../utils/workflowAuthorization');
const { assertAllowedUpload } = require('../utils/fileValidation');
const { saveUploadedFile, STORAGE_ROOT } = require('./fileStorageService');
const { notifyStage, notifyUser } = require('./notificationService');
const { listVisibleUsers, listVisibleGroups } = require('./visibilityService');

const ADHOC_ASSIGNEE_TYPES = ['user', 'group'];
const ADHOC_DEFAULT_ALLOWED_ACTIONS = ['forward', 'send_back', 'reject'];
const OWN_DOCUMENT_CONTENT_FORMATS = ['docx', 'richtext'];
const OWN_DOCUMENT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function createAdhocWorkflowTemplate(trx, tenantId, userId, isAdmin, documentType, stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new AppError(400, 'stages must be a non-empty array for an ad-hoc document type');
  }

  const visibleUsers = await listVisibleUsers(tenantId, userId, isAdmin);
  const visibleUserIds = new Set(visibleUsers.map((u) => u.id));
  const visibleGroups = await listVisibleGroups(tenantId, userId, isAdmin);
  const visibleGroupIds = new Set(visibleGroups.map((g) => g.id));

  const validatedStages = [];
  for (const rawStage of stages) {
    const stage = rawStage || {};
    assertRequiredString(stage.name, 'stages[].name');
    if (!ADHOC_ASSIGNEE_TYPES.includes(stage.assigneeType)) {
      throw new AppError(400, `stages[].assigneeType must be one of: ${ADHOC_ASSIGNEE_TYPES.join(', ')}`);
    }
    assertUuid(stage.assigneeId, 'stages[].assigneeId');
    const visibleIds = stage.assigneeType === 'user' ? visibleUserIds : visibleGroupIds;
    if (!visibleIds.has(stage.assigneeId)) {
      throw new AppError(400, `stages[].assigneeId is not visible to you (${stage.assigneeType})`);
    }
    validatedStages.push({ name: stage.name.trim(), assigneeType: stage.assigneeType, assigneeId: stage.assigneeId });
  }

  const [workflowTemplate] = await trx('workflow_templates')
    .insert({
      tenant_id: tenantId,
      name: `${documentType.name} (ad-hoc, started ${new Date().toISOString()})`,
      is_adhoc: true,
    })
    .returning('*');

  await trx('workflow_stages').insert(
    validatedStages.map((stage, index) => ({
      tenant_id: tenantId,
      workflow_template_id: workflowTemplate.id,
      stage_order: index + 1,
      name: stage.name,
      assignee_type: stage.assigneeType,
      assignee_user_id: stage.assigneeType === 'user' ? stage.assigneeId : null,
      assignee_group_id: stage.assigneeType === 'group' ? stage.assigneeId : null,
      allowed_actions: JSON.stringify(ADHOC_DEFAULT_ALLOWED_ACTIONS),
    })),
  );

  return workflowTemplate.id;
}

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
      workflow_template_id: instance.workflow_template_id,
      stage_order: instance.current_stage_order,
    })
    .first();

  return { instance, documentType, stage };
}

async function startInstance(tenantId, userId, isAdmin, documentTypeId, stages) {
  assertUuid(documentTypeId, 'documentTypeId');
  const documentType = await db('document_types').where({ tenant_id: tenantId, id: documentTypeId }).first();
  if (!documentType) {
    throw new AppError(400, 'documentTypeId does not belong to this tenant');
  }
  if (documentType.is_adhoc) {
    throw new AppError(400, 'This document type is one-off and cannot be reused to start another instance');
  }

  const latestTemplateVersion = await db('template_file_versions')
    .where({ tenant_id: tenantId, template_file_id: documentType.template_file_id })
    .orderBy('version_number', 'desc')
    .first();
  if (!latestTemplateVersion) {
    throw new AppError(400, 'The linked template file has no uploaded versions yet');
  }

  if (documentType.workflow_mode !== 'adhoc' && stages !== undefined) {
    throw new AppError(400, 'stages must not be provided for a predefined-workflow document type');
  }

  const { instance, firstStage } = await db.transaction(async (trx) => {
    let workflowTemplateId;
    if (documentType.workflow_mode === 'adhoc') {
      workflowTemplateId = await createAdhocWorkflowTemplate(trx, tenantId, userId, isAdmin, documentType, stages);
    } else {
      workflowTemplateId = documentType.workflow_template_id;
    }

    const stage = await trx('workflow_stages')
      .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId, stage_order: 1 })
      .first();
    if (!stage) {
      throw new AppError(400, 'The linked workflow template has no stages configured yet');
    }

    const [insertedInstance] = await trx('workflow_instances')
      .insert({
        tenant_id: tenantId,
        document_type_id: documentTypeId,
        template_file_version_id: latestTemplateVersion.id,
        workflow_template_id: workflowTemplateId,
        current_stage_order: 1,
        status: 'in_progress',
        created_by: userId,
      })
      .returning('*');

    return { instance: insertedInstance, firstStage: stage };
  });

  await notifyStage(tenantId, instance.id, 'assigned', firstStage, {
    documentTypeName: documentType.name,
    stageName: firstStage.name,
  });

  return instance;
}

async function startInstanceFromOwnDocument(tenantId, userId, isAdmin, { name, contentFormat, file, content, stages }) {
  assertRequiredString(name, 'name');
  if (!OWN_DOCUMENT_CONTENT_FORMATS.includes(contentFormat)) {
    throw new AppError(400, `contentFormat must be one of: ${OWN_DOCUMENT_CONTENT_FORMATS.join(', ')}`);
  }

  if (contentFormat === 'docx') {
    if (!file) {
      throw new AppError(400, 'file is required when contentFormat is "docx"');
    }
    assertAllowedUpload(file, ['docx'], OWN_DOCUMENT_MAX_UPLOAD_BYTES);
  } else if (typeof content !== 'object' || content === null) {
    throw new AppError(400, 'content must be a JSON object when contentFormat is "richtext"');
  }

  // File I/O happens before the transaction opens: the filesystem write is not
  // transactional, so keeping it outside makes the ordering explicit and matches
  // how addTemplateFileVersion/addInstanceVersion already work in this codebase.
  const versionFields =
    contentFormat === 'docx'
      ? { file_path: await saveUploadedFile(tenantId, file.buffer, file.originalname.split('.').pop().toLowerCase()) }
      : { content: JSON.stringify(content) };

  const { instance, firstStage } = await db.transaction(async (trx) => {
    const [templateFile] = await trx('template_files')
      .insert({ tenant_id: tenantId, name, content_format: contentFormat, is_adhoc: true })
      .returning('*');

    const [templateFileVersion] = await trx('template_file_versions')
      .insert({
        tenant_id: tenantId,
        template_file_id: templateFile.id,
        version_number: 1,
        uploaded_by: userId,
        ...versionFields,
      })
      .returning('*');

    const [documentType] = await trx('document_types')
      .insert({
        tenant_id: tenantId,
        name,
        template_file_id: templateFile.id,
        workflow_mode: 'adhoc',
        workflow_template_id: null,
        is_adhoc: true,
        allowed_extensions: JSON.stringify(['docx']),
        max_upload_size_bytes: OWN_DOCUMENT_MAX_UPLOAD_BYTES,
      })
      .returning('*');

    const workflowTemplateId = await createAdhocWorkflowTemplate(trx, tenantId, userId, isAdmin, { name }, stages);

    const stage = await trx('workflow_stages')
      .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId, stage_order: 1 })
      .first();
    if (!stage) {
      throw new AppError(400, 'The ad-hoc workflow template has no stages configured yet');
    }

    const [insertedInstance] = await trx('workflow_instances')
      .insert({
        tenant_id: tenantId,
        document_type_id: documentType.id,
        template_file_version_id: templateFileVersion.id,
        workflow_template_id: workflowTemplateId,
        current_stage_order: 1,
        status: 'in_progress',
        created_by: userId,
      })
      .returning('*');

    return { instance: insertedInstance, firstStage: stage };
  });

  await notifyStage(tenantId, instance.id, 'assigned', firstStage, {
    documentTypeName: name,
    stageName: firstStage.name,
  });

  return instance;
}

async function claimInstance(tenantId, userId, instanceId) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be claimed');
  }
  if (stage.assignee_type !== 'role' && stage.assignee_type !== 'group') {
    throw new AppError(400, 'The current stage is not role- or group-assigned; claiming does not apply');
  }
  if (instance.claimed_by) {
    throw new AppError(400, 'This instance has already been claimed');
  }

  if (stage.assignee_type === 'role') {
    const hasRole = await db('user_roles')
      .where({ tenant_id: tenantId, user_id: userId, role_id: stage.assignee_role_id })
      .first();
    if (!hasRole) {
      throw new AppError(403, 'You do not hold the role assigned to this stage');
    }
  } else {
    const isMember = await db('user_groups')
      .where({ tenant_id: tenantId, user_id: userId, group_id: stage.assignee_group_id })
      .first();
    if (!isMember) {
      throw new AppError(403, 'You are not a member of the group assigned to this stage');
    }
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
      workflow_template_id: instance.workflow_template_id,
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
    .where({ tenant_id: tenantId, workflow_template_id: instance.workflow_template_id, stage_order: targetStageOrder })
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
  const { instance, documentType } = await getInstanceDetail(tenantId, instanceId);

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
      workflow_template_id: instance.workflow_template_id,
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
  startInstanceFromOwnDocument,
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
