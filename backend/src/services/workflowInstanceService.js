const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid } = require('../utils/validation');

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

module.exports = { getInstanceDetail, startInstance };
