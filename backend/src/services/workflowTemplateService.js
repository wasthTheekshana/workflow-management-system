const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');

async function createWorkflowTemplate(tenantId, name) {
  assertRequiredString(name, 'name');
  const [workflowTemplate] = await db('workflow_templates').insert({ tenant_id: tenantId, name }).returning('*');
  return workflowTemplate;
}

async function listWorkflowTemplates(tenantId) {
  return db('workflow_templates').where({ tenant_id: tenantId }).orderBy('created_at', 'desc');
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

module.exports = { createWorkflowTemplate, listWorkflowTemplates, getWorkflowTemplate };
