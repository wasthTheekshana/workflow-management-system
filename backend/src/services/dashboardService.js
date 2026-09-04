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
      'document_types.workflow_template_id',
    );

  const userRoleIds = (
    await db('user_roles').where({ tenant_id: tenantId, user_id: userId }).select('role_id')
  ).map((row) => row.role_id);
  const userGroupIds = (
    await db('user_groups').where({ tenant_id: tenantId, user_id: userId }).select('group_id')
  ).map((row) => row.group_id);

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

    const eligibleToClaimRole =
      stage.assignee_type === 'role' && !instance.claimed_by && userRoleIds.includes(stage.assignee_role_id);
    const eligibleToClaimGroup =
      stage.assignee_type === 'group' && !instance.claimed_by && userGroupIds.includes(stage.assignee_group_id);
    const isMine = canAct(stage, instance, userId) || eligibleToClaimRole || eligibleToClaimGroup;

    if (isMine) {
      assignedToMe.push({ ...instance, currentStage: stage });
    } else if (instance.created_by === userId) {
      waitingOnOthers.push({ ...instance, currentStage: stage });
    }
  }

  const completed = await db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where({ 'workflow_instances.tenant_id': tenantId, 'workflow_instances.created_by': userId })
    .whereIn('workflow_instances.status', ['completed', 'rejected'])
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

  return {
    instance,
    documentType: { id: documentType.id, name: documentType.name },
    currentStage: stage,
    versions,
    auditLog,
  };
}

async function listInstancesForAdmin(tenantId, { status, documentTypeId } = {}) {
  let query = db('workflow_instances')
    .join('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where({ 'workflow_instances.tenant_id': tenantId })
    .select('workflow_instances.*', 'document_types.name as document_type_name')
    .orderBy('workflow_instances.created_at', 'desc');

  if (status) {
    query = query.where('workflow_instances.status', status);
  }
  if (documentTypeId) {
    query = query.where('workflow_instances.document_type_id', documentTypeId);
  }

  return query;
}

module.exports = { listMyTasks, getInstanceHistory, listInstancesForAdmin };
