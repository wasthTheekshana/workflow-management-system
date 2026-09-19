const db = require('../config/db');
const { canAct } = require('../utils/workflowAuthorization');
const { getInstanceDetail } = require('./workflowInstanceService');

async function listMyTasks(tenantId, userId) {
  const inProgress = await db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where({ 'workflow_instances.tenant_id': tenantId, 'workflow_instances.status': 'in_progress' })
    .select(
      'workflow_instances.*',
      'document_types.name as document_type_name',
    );

  const userRoleIds = (
    await db('user_roles').where({ tenant_id: tenantId, user_id: userId }).select('role_id')
  ).map((row) => row.role_id);
  const userGroupIds = (
    await db('user_groups').where({ tenant_id: tenantId, user_id: userId }).select('group_id')
  ).map((row) => row.group_id);
  const userGroupRows = await db('user_groups')
    .where({ tenant_id: tenantId, user_id: userId })
    .select('group_id', 'level');
  const userGroupLevelMap = new Map(userGroupRows.map((row) => [row.group_id, row.level]));

  const assignedToMe = [];
  const waitingOnOthers = [];

  for (const instance of inProgress) {
    const stage = await db('workflow_stages')
      .where({
        tenant_id: tenantId,
        workflow_template_id: instance.workflow_template_id,
        stage_order: instance.current_stage_order,
      })
      .first();

    const isParallel = stage && (stage.consensus_type === 'all' || stage.consensus_type === 'any');
    const userApproval = await db('instance_stage_approvals')
      .where({
        tenant_id: tenantId,
        workflow_instance_id: instance.id,
        stage_order: instance.current_stage_order,
        user_id: userId,
      })
      .first();
    const hasApproved = Boolean(userApproval && userApproval.decision === 'approved');

    const eligibleToClaimRole =
      stage.assignee_type === 'role' && (!instance.claimed_by || isParallel) && userRoleIds.includes(stage.assignee_role_id);
    const eligibleToClaimGroup =
      stage.assignee_type === 'group' &&
      (!instance.claimed_by || isParallel) &&
      userGroupLevelMap.has(stage.assignee_group_id) &&
      (!stage.assignee_group_level || userGroupLevelMap.get(stage.assignee_group_id) === stage.assignee_group_level);
    const isMine = canAct(stage, instance, userId) || eligibleToClaimRole || eligibleToClaimGroup;

    const now = new Date();
    const isOverdue = Boolean(
      instance.stage_due_at &&
      new Date(instance.stage_due_at) < now &&
      instance.status === 'in_progress'
    );
    const enriched = { ...instance, currentStage: stage, is_overdue: isOverdue, has_approved: hasApproved };

    if (isMine && (!hasApproved || stage.consensus_type !== 'all')) {
      assignedToMe.push(enriched);
    } else if (instance.created_by === userId || hasApproved) {
      waitingOnOthers.push(enriched);
    }
  }

  const completed = await db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where({ 'workflow_instances.tenant_id': tenantId, 'workflow_instances.created_by': userId })
    .whereIn('workflow_instances.status', ['completed', 'rejected'])
    .whereIn('workflow_instances.status', ['completed', 'rejected', 'cancelled'])
    .select('workflow_instances.*', 'document_types.name as document_type_name')
    .orderBy('workflow_instances.updated_at', 'desc');

  return { assignedToMe, waitingOnOthers, completed };
}

async function getInstanceHistory(tenantId, instanceId) {
  const { instance, documentType, stage } = await getInstanceDetail(tenantId, instanceId);

  const versions = await db('instance_versions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('version_number', 'asc');

  const auditLog = await db('stage_actions')
    .where({ tenant_id: tenantId, workflow_instance_id: instanceId })
    .orderBy('created_at', 'asc');

  const workflowStages = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: instance.workflow_template_id })
    .orderBy('stage_order', 'asc');

  const now = new Date();
  const isOverdue = Boolean(
    instance.stage_due_at &&
    new Date(instance.stage_due_at) < now &&
    instance.status === 'in_progress'
  );

  return {
    instance: {
      ...instance,
      is_overdue: isOverdue,
    },
    documentType: { id: documentType.id, name: documentType.name },
    currentStage: stage,
    workflowStages,
    versions,
    auditLog,
  };
}

async function listInstancesForAdmin(tenantId, { status, documentTypeId, isOverdue } = {}) {
  let query = db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .leftJoin('users as creator', 'creator.id', 'workflow_instances.created_by')
    .leftJoin('users as claimant', 'claimant.id', 'workflow_instances.claimed_by')
    .where({ 'workflow_instances.tenant_id': tenantId })
    .select(
      'workflow_instances.*',
      'document_types.name as document_type_name',
      'creator.email as creator_email',
      'creator.full_name as creator_name',
      'claimant.email as claimant_email',
      'claimant.full_name as claimant_name'
    )
    .orderBy('workflow_instances.created_at', 'desc');

  if (status) {
    query = query.where('workflow_instances.status', status);
  }
  if (documentTypeId) {
    query = query.where('workflow_instances.document_type_id', documentTypeId);
  }

  const instances = await query;

  const templateIds = [...new Set(instances.map((i) => i.workflow_template_id).filter(Boolean))];
  const stages = templateIds.length
    ? await db('workflow_stages')
        .where({ tenant_id: tenantId })
        .whereIn('workflow_template_id', templateIds)
    : [];

  const stageMap = new Map();
  for (const s of stages) {
    stageMap.set(`${s.workflow_template_id}:${s.stage_order}`, s);
  }

  const now = new Date();
  let result = instances.map((instance) => {
    const overdue = Boolean(
      instance.stage_due_at &&
      new Date(instance.stage_due_at) < now &&
      instance.status === 'in_progress'
    );
    return {
      ...instance,
      currentStage: stageMap.get(`${instance.workflow_template_id}:${instance.current_stage_order}`) || null,
      is_overdue: overdue,
    };
  });

  if (isOverdue === true || isOverdue === 'true') {
    result = result.filter((i) => i.is_overdue);
  }

  return result;
}

module.exports = { listMyTasks, getInstanceHistory, listInstancesForAdmin };
