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

function calculateStageDueAt(stage, enteredAt = new Date()) {
  if (!stage || !stage.sla_hours) return null;
  return new Date(enteredAt.getTime() + stage.sla_hours * 3600 * 1000);
}

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
    let assigneeGroupLevel = null;
    if (
      stage.assigneeType === 'group' &&
      stage.assigneeGroupLevel !== undefined &&
      stage.assigneeGroupLevel !== null &&
      stage.assigneeGroupLevel !== ''
    ) {
      const lvl = Number(stage.assigneeGroupLevel);
      if (!Number.isInteger(lvl) || lvl < 1) {
        throw new AppError(400, 'stages[].assigneeGroupLevel must be a positive integer');
      }
      assigneeGroupLevel = lvl;
    }

    let slaHours = null;
    if (stage.slaHours !== undefined && stage.slaHours !== null && stage.slaHours !== '') {
      const num = Number(stage.slaHours);
      if (!Number.isInteger(num) || num <= 0) {
        throw new AppError(400, 'stages[].slaHours must be a positive integer');
      }
      slaHours = num;
    }

    let consensusType = 'single';
    if (stage.consensusType !== undefined && stage.consensusType !== null && stage.consensusType !== '') {
      if (!['single', 'all', 'any'].includes(stage.consensusType)) {
        throw new AppError(400, 'stages[].consensusType must be one of: single, all, any');
      }
      consensusType = stage.consensusType;
    }

    validatedStages.push({
      name: stage.name.trim(),
      assigneeType: stage.assigneeType,
      assigneeId: stage.assigneeId,
      assigneeGroupLevel,
      slaHours,
      consensusType,
    });
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
      assignee_group_level: stage.assigneeType === 'group' ? stage.assigneeGroupLevel : null,
      allowed_actions: JSON.stringify(ADHOC_DEFAULT_ALLOWED_ACTIONS),
      sla_hours: stage.slaHours,
      consensus_type: stage.consensusType,
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

async function getEligibleApprovers(tenantId, stage) {
  if (!stage) return [];
  if (stage.assignee_type === 'user') {
    if (!stage.assignee_user_id) return [];
    const user = await db('users').where({ tenant_id: tenantId, id: stage.assignee_user_id }).first();
    return user ? [{ id: user.id, email: user.email, name: user.email, type: 'user' }] : [];
  }
  if (stage.assignee_type === 'role') {
    if (!stage.assignee_role_id) return [];
    const roleUsers = await db('user_roles')
      .join('users', function () {
        this.on('users.id', '=', 'user_roles.user_id')
          .andOn('users.tenant_id', '=', 'user_roles.tenant_id');
      })
      .where({ 'user_roles.tenant_id': tenantId, 'user_roles.role_id': stage.assignee_role_id })
      .select('users.id', 'users.email')
      .orderBy('users.email', 'asc');
    return roleUsers.map((u) => ({ id: u.id, email: u.email, name: u.email, type: 'role' }));
  }
  if (stage.assignee_type === 'group') {
    if (!stage.assignee_group_id) return [];
    const query = db('user_groups')
      .join('users', function () {
        this.on('users.id', '=', 'user_groups.user_id')
          .andOn('users.tenant_id', '=', 'user_groups.tenant_id');
      })
      .where({ 'user_groups.tenant_id': tenantId, 'user_groups.group_id': stage.assignee_group_id })
      .select('users.id', 'users.email', 'user_groups.level')
      .orderBy('users.email', 'asc');
    if (stage.assignee_group_level) {
      query.andWhere('user_groups.level', stage.assignee_group_level);
    }
    const groupUsers = await query;
    return groupUsers.map((u) => ({ id: u.id, email: u.email, name: u.email, level: u.level, type: 'group' }));
  }
  return [];
}

async function isUserEligibleApprover(tenantId, stage, userId, isAdmin = false) {
  if (!stage) return false;
  if (isAdmin) return true;
  if (stage.assignee_type === 'user') {
    return stage.assignee_user_id === userId;
  }
  if (stage.assignee_type === 'role') {
    const hasRole = await db('user_roles')
      .where({ tenant_id: tenantId, user_id: userId, role_id: stage.assignee_role_id })
      .first();
    return Boolean(hasRole);
  }
  if (stage.assignee_type === 'group') {
    const q = { tenant_id: tenantId, user_id: userId, group_id: stage.assignee_group_id };
    if (stage.assignee_group_level) {
      q.level = stage.assignee_group_level;
    }
    const isMember = await db('user_groups').where(q).first();
    return Boolean(isMember);
  }
  return false;
}

async function getStageApprovals(tenantId, instanceId, stageOrder) {
  const { instance } = await getInstanceDetail(tenantId, instanceId);
  const targetStageOrder = stageOrder !== undefined && stageOrder !== null ? Number(stageOrder) : instance.current_stage_order;

  const stage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: instance.workflow_template_id, stage_order: targetStageOrder })
    .first();

  const approvals = await db('instance_stage_approvals')
    .join('users', function () {
      this.on('users.id', '=', 'instance_stage_approvals.user_id')
        .andOn('users.tenant_id', '=', 'instance_stage_approvals.tenant_id');
    })
    .where({
      'instance_stage_approvals.tenant_id': tenantId,
      'instance_stage_approvals.workflow_instance_id': instanceId,
      'instance_stage_approvals.stage_order': targetStageOrder,
    })
    .select(
      'instance_stage_approvals.id',
      'instance_stage_approvals.user_id',
      'users.email as user_email',
      'instance_stage_approvals.decision',
      'instance_stage_approvals.comment',
      'instance_stage_approvals.created_at',
    )
    .orderBy('instance_stage_approvals.created_at', 'asc');

  const eligibleApprovers = stage ? await getEligibleApprovers(tenantId, stage) : [];
  const consensusType = stage ? stage.consensus_type || 'single' : 'single';

  const approvalMap = new Map(approvals.map((a) => [a.user_id, a]));
  const approversStatus = eligibleApprovers.map((ea) => {
    const app = approvalMap.get(ea.id);
    return {
      id: ea.id,
      email: ea.email,
      level: ea.level,
      hasApproved: Boolean(app && app.decision === 'approved'),
      decision: app ? app.decision : null,
      comment: app ? app.comment : null,
      approvedAt: app ? app.created_at : null,
    };
  });

  const approvedCount = approversStatus.filter((a) => a.hasApproved).length;
  const totalRequired = consensusType === 'any' ? 1 : Math.max(1, eligibleApprovers.length);
  const consensusReached = consensusType === 'any' ? approvedCount >= 1 : approvedCount >= totalRequired;

  return {
    stageOrder: targetStageOrder,
    stageName: stage ? stage.name : `Stage ${targetStageOrder}`,
    consensusType,
    totalRequired,
    approvedCount,
    consensusReached,
    approvals,
    eligibleApprovers: approversStatus,
  };
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

    const now = new Date();
    const stageDueAt = calculateStageDueAt(stage, now);

    const [insertedInstance] = await trx('workflow_instances')
      .insert({
        tenant_id: tenantId,
        document_type_id: documentTypeId,
        template_file_version_id: latestTemplateVersion.id,
        workflow_template_id: workflowTemplateId,
        current_stage_order: 1,
        status: 'in_progress',
        created_by: userId,
        stage_entered_at: now,
        stage_due_at: stageDueAt,
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

    const now = new Date();
    const stageDueAt = calculateStageDueAt(stage, now);

    const [insertedInstance] = await trx('workflow_instances')
      .insert({
        tenant_id: tenantId,
        document_type_id: documentType.id,
        template_file_version_id: templateFileVersion.id,
        workflow_template_id: workflowTemplateId,
        current_stage_order: 1,
        status: 'in_progress',
        created_by: userId,
        stage_entered_at: now,
        stage_due_at: stageDueAt,
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
  if (stage.consensus_type === 'all') {
    throw new AppError(
      400,
      'This stage uses parallel AND consensus; claiming is not required - approvers can review and approve directly',
    );
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
    const memberQuery = {
      tenant_id: tenantId,
      user_id: userId,
      group_id: stage.assignee_group_id,
    };
    if (stage.assignee_group_level) {
      memberQuery.level = stage.assignee_group_level;
    }
    const isMember = await db('user_groups').where(memberQuery).first();
    if (!isMember) {
      throw new AppError(
        403,
        stage.assignee_group_level
          ? `You are not a Level ${stage.assignee_group_level} member of the group assigned to this stage`
          : 'You are not a member of the group assigned to this stage',
      );
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

async function unclaimInstance(tenantId, userId, instanceId, isAdmin = false) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be unclaimed');
  }
  if (stage.assignee_type !== 'role' && stage.assignee_type !== 'group') {
    throw new AppError(400, 'The current stage is not role- or group-assigned; unclaiming does not apply');
  }
  if (!instance.claimed_by) {
    throw new AppError(400, 'This instance is not currently claimed');
  }
  if (instance.claimed_by !== userId && !isAdmin) {
    throw new AppError(403, 'You are not the claimant of this instance');
  }

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ claimed_by: null })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'unclaim',
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

  const consensusType = stage.consensus_type || 'single';

  if (consensusType === 'all' || consensusType === 'any') {
    const eligible = await isUserEligibleApprover(tenantId, stage, userId);
    if (!eligible) {
      throw new AppError(403, 'You are not authorized to act on this instance right now');
    }

    const existingApproval = await db('instance_stage_approvals')
      .where({
        tenant_id: tenantId,
        workflow_instance_id: instanceId,
        stage_order: instance.current_stage_order,
        user_id: userId,
      })
      .first();

    if (existingApproval && existingApproval.decision === 'approved') {
      throw new AppError(400, 'You have already submitted an approval for this stage');
    }

    await db('instance_stage_approvals')
      .insert({
        tenant_id: tenantId,
        workflow_instance_id: instanceId,
        stage_order: instance.current_stage_order,
        user_id: userId,
        decision: 'approved',
        comment: comment || null,
      })
      .onConflict(['tenant_id', 'workflow_instance_id', 'stage_order', 'user_id'])
      .merge({
        decision: 'approved',
        comment: comment || null,
        created_at: db.fn.now(),
      });

    await db('stage_actions').insert({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      action_type: 'approval_recorded',
      from_stage_order: instance.current_stage_order,
      to_stage_order: instance.current_stage_order,
      actor_id: userId,
      comment: comment || null,
    });

    const eligibleApprovers = await getEligibleApprovers(tenantId, stage);
    const totalRequired = consensusType === 'any' ? 1 : Math.max(1, eligibleApprovers.length);

    const stageApprovals = await db('instance_stage_approvals')
      .where({
        tenant_id: tenantId,
        workflow_instance_id: instanceId,
        stage_order: instance.current_stage_order,
        decision: 'approved',
      });

    const approvedUserIds = new Set(stageApprovals.map((a) => a.user_id));
    const approvedCount = consensusType === 'any'
      ? stageApprovals.length
      : eligibleApprovers.filter((u) => approvedUserIds.has(u.id)).length;

    const consensusReached = consensusType === 'any' ? stageApprovals.length >= 1 : approvedCount >= totalRequired;

    if (!consensusReached) {
      return {
        ...instance,
        consensus: {
          type: consensusType,
          reached: false,
          approvedCount,
          totalRequired,
        },
      };
    }
  } else {
    if (!canAct(stage, instance, userId)) {
      throw new AppError(403, 'You are not authorized to act on this instance right now');
    }

    await db('instance_stage_approvals')
      .insert({
        tenant_id: tenantId,
        workflow_instance_id: instanceId,
        stage_order: instance.current_stage_order,
        user_id: userId,
        decision: 'approved',
        comment: comment || null,
      })
      .onConflict(['tenant_id', 'workflow_instance_id', 'stage_order', 'user_id'])
      .merge({
        decision: 'approved',
        comment: comment || null,
        created_at: db.fn.now(),
      });
  }

  const nextStage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: instance.workflow_template_id,
      stage_order: instance.current_stage_order + 1,
    })
    .first();

  const now = new Date();
  let updates;
  if (nextStage) {
    updates = {
      current_stage_order: nextStage.stage_order,
      claimed_by: null,
      stage_entered_at: now,
      stage_due_at: calculateStageDueAt(nextStage, now),
    };
  } else {
    updates = { status: 'completed', stage_due_at: null };
  }

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

  return {
    ...updated,
    consensus: {
      type: consensusType,
      reached: true,
    },
  };
}

async function sendBackInstance(tenantId, userId, instanceId, comment, targetStageOrder) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be sent back');
  }
  if (!stage.allowed_actions.includes('send_back')) {
    throw new AppError(400, 'The current stage does not allow sending back');
  }

  const consensusType = stage.consensus_type || 'single';
  if (consensusType === 'all' || consensusType === 'any') {
    const eligible = await isUserEligibleApprover(tenantId, stage, userId);
    if (!eligible) {
      throw new AppError(403, 'You are not authorized to act on this instance right now');
    }
  } else {
    if (!canAct(stage, instance, userId)) {
      throw new AppError(403, 'You are not authorized to act on this instance right now');
    }
  }

  if (instance.current_stage_order <= 1) {
    throw new AppError(400, 'Cannot send back from the first stage');
  }

  let resolvedTargetStageOrder;
  if (targetStageOrder !== undefined && targetStageOrder !== null && targetStageOrder !== '') {
    const orderNum = Number(targetStageOrder);
    if (!Number.isInteger(orderNum) || orderNum < 1 || orderNum >= instance.current_stage_order) {
      throw new AppError(
        400,
        `targetStageOrder must be an integer between 1 and ${instance.current_stage_order - 1}`,
      );
    }
    resolvedTargetStageOrder = orderNum;
  } else {
    resolvedTargetStageOrder = instance.current_stage_order - 1;
  }

  const targetStage = await db('workflow_stages')
    .where({
      tenant_id: tenantId,
      workflow_template_id: instance.workflow_template_id,
      stage_order: resolvedTargetStageOrder,
    })
    .first();

  if (!targetStage) {
    throw new AppError(400, `Target stage order ${resolvedTargetStageOrder} does not exist in this workflow`);
  }

  // Clear stage approvals for stages being sent back to and after
  await db('instance_stage_approvals')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .where('stage_order', '>=', resolvedTargetStageOrder)
    .del();

  const now = new Date();
  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({
      current_stage_order: resolvedTargetStageOrder,
      claimed_by: null,
      stage_entered_at: now,
      stage_due_at: calculateStageDueAt(targetStage, now),
    })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'send_back',
    from_stage_order: instance.current_stage_order,
    to_stage_order: resolvedTargetStageOrder,
    actor_id: userId,
    comment: comment || null,
  });

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

  const consensusType = stage.consensus_type || 'single';
  if (consensusType === 'all' || consensusType === 'any') {
    const eligible = await isUserEligibleApprover(tenantId, stage, userId);
    if (!eligible) {
      throw new AppError(403, 'You are not authorized to act on this instance right now');
    }
  } else {
    if (!canAct(stage, instance, userId)) {
      throw new AppError(403, 'You are not authorized to act on this instance right now');
    }
  }

  await db('instance_stage_approvals')
    .insert({
      tenant_id: tenantId,
      workflow_instance_id: instanceId,
      stage_order: instance.current_stage_order,
      user_id: userId,
      decision: 'rejected',
      comment: comment || null,
    })
    .onConflict(['tenant_id', 'workflow_instance_id', 'stage_order', 'user_id'])
    .merge({
      decision: 'rejected',
      comment: comment || null,
      created_at: db.fn.now(),
    });

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({ status: 'rejected', stage_due_at: null })
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

  if (instance.status !== 'rejected' && instance.status !== 'cancelled') {
    throw new AppError(400, 'Only rejected or cancelled instances can be resubmitted');
  }
  if (instance.created_by !== userId) {
    throw new AppError(403, 'Only the original submitter can resubmit this instance');
  }

  const stage1 = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: instance.workflow_template_id, stage_order: 1 })
    .first();
  const now = new Date();

  const [newInstance] = await db('workflow_instances')
    .insert({
      tenant_id: tenantId,
      document_type_id: instance.document_type_id,
      template_file_version_id: instance.template_file_version_id,
      workflow_template_id: instance.workflow_template_id,
      current_stage_order: 1,
      status: 'in_progress',
      created_by: userId,
      stage_entered_at: now,
      stage_due_at: calculateStageDueAt(stage1, now),
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

async function cancelInstance(tenantId, userId, isAdmin, instanceId, comment) {
  const { instance, documentType } = await getInstanceDetail(tenantId, instanceId);

  if (instance.status !== 'in_progress') {
    throw new AppError(400, 'Only in-progress instances can be cancelled');
  }

  if (instance.created_by !== userId && !isAdmin) {
    throw new AppError(403, 'Only the submitter or an admin can cancel this workflow');
  }

  const [updated] = await db('workflow_instances')
    .where({ tenant_id: tenantId, id: instanceId })
    .update({
      status: 'cancelled',
      claimed_by: null,
      stage_due_at: null,
      updated_at: db.fn.now(),
    })
    .returning('*');

  await db('stage_actions').insert({
    tenant_id: tenantId,
    workflow_instance_id: instanceId,
    action_type: 'cancel',
    from_stage_order: instance.current_stage_order,
    to_stage_order: null,
    actor_id: userId,
    comment: comment || null,
  });

  if (isAdmin && instance.created_by !== userId) {
    await notifyUser(tenantId, instanceId, 'cancelled', instance.created_by, {
      documentTypeName: documentType.name,
      comment,
    });
  }

  return updated;
}

module.exports = {
  getInstanceDetail,
  startInstance,
  startInstanceFromOwnDocument,
  claimInstance,
  unclaimInstance,
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
  cancelInstance,
  getStageApprovals,
  getEligibleApprovers,
  isUserEligibleApprover,
};
