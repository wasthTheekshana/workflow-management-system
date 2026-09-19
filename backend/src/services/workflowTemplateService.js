const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');

async function createWorkflowTemplate(tenantId, name) {
  assertRequiredString(name, 'name');
  const [workflowTemplate] = await db('workflow_templates').insert({ tenant_id: tenantId, name }).returning('*');
  return workflowTemplate;
}

async function listWorkflowTemplates(tenantId) {
  return db('workflow_templates').where({ tenant_id: tenantId, is_adhoc: false }).orderBy('created_at', 'desc');
}

async function getWorkflowTemplate(tenantId, workflowTemplateId) {
  assertUuid(workflowTemplateId, 'workflowTemplateId');
  const workflowTemplate = await db('workflow_templates')
    .where({ tenant_id: tenantId, id: workflowTemplateId })
    .first();
  if (!workflowTemplate) {
    throw new AppError(404, 'Workflow template not found');
  }
  const stages = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId })
    .orderBy('stage_order', 'asc');
  return { ...workflowTemplate, stages };
}

const ALLOWED_ASSIGNEE_TYPES = ['user', 'role', 'group'];
const ALLOWED_ACTIONS = ['forward', 'send_back', 'reject'];
const ALLOWED_CONSENSUS_TYPES = ['single', 'all', 'any'];

function parseConsensusType(type) {
  if (type === undefined || type === null || type === '') {
    return 'single';
  }
  if (!ALLOWED_CONSENSUS_TYPES.includes(type)) {
    throw new AppError(400, `consensusType must be one of: ${ALLOWED_CONSENSUS_TYPES.join(', ')}`);
  }
  return type;
}

async function validateStageAssignment(
  tenantId,
  { assigneeType, assigneeUserId, assigneeRoleId, assigneeGroupId, assigneeGroupLevel, allowedActions },
) {
  if (!ALLOWED_ASSIGNEE_TYPES.includes(assigneeType)) {
    throw new AppError(400, `assigneeType must be one of: ${ALLOWED_ASSIGNEE_TYPES.join(', ')}`);
  }

  if (assigneeType === 'user') {
    assertUuid(assigneeUserId, 'assigneeUserId');
    const user = await db('users').where({ tenant_id: tenantId, id: assigneeUserId }).first();
    if (!user) {
      throw new AppError(400, 'assigneeUserId does not belong to this tenant');
    }
  } else if (assigneeType === 'role') {
    assertUuid(assigneeRoleId, 'assigneeRoleId');
    const role = await db('roles').where({ tenant_id: tenantId, id: assigneeRoleId }).first();
    if (!role) {
      throw new AppError(400, 'assigneeRoleId does not belong to this tenant');
    }
  } else {
    assertUuid(assigneeGroupId, 'assigneeGroupId');
    const group = await db('groups').where({ tenant_id: tenantId, id: assigneeGroupId }).first();
    if (!group) {
      throw new AppError(400, 'assigneeGroupId does not belong to this tenant');
    }
    if (assigneeGroupLevel !== undefined && assigneeGroupLevel !== null && assigneeGroupLevel !== '') {
      const level = Number(assigneeGroupLevel);
      if (!Number.isInteger(level) || level < 1) {
        throw new AppError(400, 'assigneeGroupLevel must be a positive integer');
      }
    }
  }

  const actions = Array.isArray(allowedActions) && allowedActions.length > 0 ? allowedActions : ALLOWED_ACTIONS;
  const invalidAction = actions.find((action) => !ALLOWED_ACTIONS.includes(action));
  if (invalidAction) {
    throw new AppError(400, `Invalid action "${invalidAction}". Allowed actions: ${ALLOWED_ACTIONS.join(', ')}`);
  }
  return actions;
}

async function addWorkflowStage(tenantId, workflowTemplateId, input) {
  assertUuid(workflowTemplateId, 'workflowTemplateId');
  const workflowTemplate = await db('workflow_templates')
    .where({ tenant_id: tenantId, id: workflowTemplateId })
    .first();
  if (!workflowTemplate) {
    throw new AppError(404, 'Workflow template not found');
  }

  const {
    stageOrder,
    name,
    assigneeType,
    assigneeUserId,
    assigneeRoleId,
    assigneeGroupId,
    assigneeGroupLevel,
    allowedActions,
    slaHours,
    consensusType,
  } = input;

  const validConsensusType = parseConsensusType(consensusType);

  if (!Number.isInteger(stageOrder) || stageOrder < 1) {
    throw new AppError(400, 'stageOrder must be a positive integer');
  }
  assertRequiredString(name, 'name');
  const actions = await validateStageAssignment(tenantId, {
    assigneeType,
    assigneeUserId,
    assigneeRoleId,
    assigneeGroupId,
    assigneeGroupLevel,
    allowedActions,
  });

  let parsedSlaHours = null;
  if (slaHours !== undefined && slaHours !== null && slaHours !== '') {
    const num = Number(slaHours);
    if (!Number.isInteger(num) || num <= 0) {
      throw new AppError(400, 'slaHours must be a positive integer');
    }
    parsedSlaHours = num;
  }

  const existingStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId, stage_order: stageOrder })
    .first();
  if (existingStage) {
    throw new AppError(400, `stageOrder ${stageOrder} already exists on this workflow template`);
  }

  const [stage] = await db('workflow_stages')
    .insert({
      tenant_id: tenantId,
      workflow_template_id: workflowTemplateId,
      stage_order: stageOrder,
      name,
      assignee_type: assigneeType,
      assignee_user_id: assigneeType === 'user' ? assigneeUserId : null,
      assignee_role_id: assigneeType === 'role' ? assigneeRoleId : null,
      assignee_group_id: assigneeType === 'group' ? assigneeGroupId : null,
      assignee_group_level:
        assigneeType === 'group' && assigneeGroupLevel !== undefined && assigneeGroupLevel !== null && assigneeGroupLevel !== ''
          ? Number(assigneeGroupLevel)
          : null,
      allowed_actions: JSON.stringify(actions),
      sla_hours: parsedSlaHours,
      consensus_type: validConsensusType,
    })
    .returning('*');

  return stage;
}

// Updates an existing stage's name/assignee/allowed actions in place. Since
// running instances resolve their current stage live by
// (workflow_template_id, stage_order) rather than snapshotting it at start
// time, this immediately re-points any in-progress instance currently
// sitting at this stage to the new assignee — the same "reassign" effect an
// admin gets from rebuilding the template, without needing to.
async function updateWorkflowStage(tenantId, workflowTemplateId, stageOrder, input) {
  assertUuid(workflowTemplateId, 'workflowTemplateId');
  if (!Number.isInteger(stageOrder) || stageOrder < 1) {
    throw new AppError(400, 'stageOrder must be a positive integer');
  }

  const existingStage = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId, stage_order: stageOrder })
    .first();
  if (!existingStage) {
    throw new AppError(404, 'Stage not found');
  }

  const {
    name,
    assigneeType,
    assigneeUserId,
    assigneeRoleId,
    assigneeGroupId,
    assigneeGroupLevel,
    allowedActions,
    slaHours,
    consensusType,
  } = input;
  assertRequiredString(name, 'name');
  const actions = await validateStageAssignment(tenantId, {
    assigneeType,
    assigneeUserId,
    assigneeRoleId,
    assigneeGroupId,
    assigneeGroupLevel,
    allowedActions,
  });

  const validConsensusType = parseConsensusType(consensusType);

  let parsedSlaHours = null;
  if (slaHours !== undefined && slaHours !== null && slaHours !== '') {
    const num = Number(slaHours);
    if (!Number.isInteger(num) || num <= 0) {
      throw new AppError(400, 'slaHours must be a positive integer');
    }
    parsedSlaHours = num;
  }

  const [stage] = await db('workflow_stages')
    .where({ tenant_id: tenantId, workflow_template_id: workflowTemplateId, stage_order: stageOrder })
    .update({
      name,
      assignee_type: assigneeType,
      assignee_user_id: assigneeType === 'user' ? assigneeUserId : null,
      assignee_role_id: assigneeType === 'role' ? assigneeRoleId : null,
      assignee_group_id: assigneeType === 'group' ? assigneeGroupId : null,
      assignee_group_level:
        assigneeType === 'group' && assigneeGroupLevel !== undefined && assigneeGroupLevel !== null && assigneeGroupLevel !== ''
          ? Number(assigneeGroupLevel)
          : null,
      allowed_actions: JSON.stringify(actions),
      sla_hours: parsedSlaHours,
      consensus_type: validConsensusType,
    })
    .returning('*');

  return stage;
}

module.exports = {
  createWorkflowTemplate,
  listWorkflowTemplates,
  getWorkflowTemplate,
  addWorkflowStage,
  updateWorkflowStage,
};
