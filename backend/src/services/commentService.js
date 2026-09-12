const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertRequiredString } = require('../utils/validation');
const { canAct } = require('../utils/workflowAuthorization');
const { getInstanceDetail } = require('./workflowInstanceService');
const { notifyEmails, resolveStageRecipientEmails } = require('./notificationService');

async function isInvolvedInInstance(tenantId, instance, stage, userId, isAdmin) {
  if (isAdmin) {
    return true;
  }
  if (instance.created_by === userId) {
    return true;
  }

  const hasActed = await db('stage_actions')
    .where({ tenant_id: tenantId, workflow_instance_id: instance.id, actor_id: userId })
    .first();
  if (hasActed) {
    return true;
  }

  if (canAct(stage, instance, userId)) {
    return true;
  }

  if (!instance.claimed_by) {
    if (stage.assignee_type === 'role') {
      const hasRole = await db('user_roles')
        .where({ tenant_id: tenantId, user_id: userId, role_id: stage.assignee_role_id })
        .first();
      if (hasRole) {
        return true;
      }
    }
    if (stage.assignee_type === 'group') {
      const isMember = await db('user_groups')
        .where({ tenant_id: tenantId, user_id: userId, group_id: stage.assignee_group_id })
        .first();
      if (isMember) {
        return true;
      }
    }
  }

  return false;
}

function toCommentDto(row) {
  return {
    id: row.id,
    author_id: row.author_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at,
  };
}

async function listComments(tenantId, userId, isAdmin, instanceId) {
  const { instance, stage } = await getInstanceDetail(tenantId, instanceId);
  if (!(await isInvolvedInInstance(tenantId, instance, stage, userId, isAdmin))) {
    throw new AppError(403, 'You are not involved in this workflow instance');
  }

  const rows = await db('comments')
    .join('users', 'users.id', 'comments.author_id')
    .where({ 'comments.tenant_id': tenantId, 'comments.workflow_instance_id': instanceId })
    .orderBy('comments.created_at', 'asc')
    .select(
      'comments.id',
      'comments.author_id',
      db.raw('COALESCE(users.full_name, users.email) as author_name'),
      'comments.body',
      'comments.created_at',
    );

  return rows.map(toCommentDto);
}

async function addComment(tenantId, userId, isAdmin, instanceId, body) {
  const { instance, stage, documentType } = await getInstanceDetail(tenantId, instanceId);
  if (!(await isInvolvedInInstance(tenantId, instance, stage, userId, isAdmin))) {
    throw new AppError(403, 'You are not involved in this workflow instance');
  }
  assertRequiredString(body, 'body');

  const [inserted] = await db('comments')
    .insert({ tenant_id: tenantId, workflow_instance_id: instanceId, author_id: userId, body })
    .returning('*');

  const author = await db('users').where({ tenant_id: tenantId, id: userId }).first();

  const recipientEmails = new Set();

  const creator = await db('users').where({ tenant_id: tenantId, id: instance.created_by }).first();
  if (creator) {
    recipientEmails.add(creator.email);
  }

  const actorRows = await db('stage_actions')
    .join('users', 'users.id', 'stage_actions.actor_id')
    .where({ 'stage_actions.tenant_id': tenantId, 'stage_actions.workflow_instance_id': instanceId })
    .distinct('users.email')
    .select('users.email');
  actorRows.forEach((row) => recipientEmails.add(row.email));

  const stageEmails = await resolveStageRecipientEmails(tenantId, stage);
  stageEmails.forEach((email) => recipientEmails.add(email));

  recipientEmails.delete(author.email);

  await notifyEmails(tenantId, instanceId, 'commented', Array.from(recipientEmails), {
    documentTypeName: documentType.name,
    authorName: author.full_name || author.email,
  });

  return toCommentDto({
    id: inserted.id,
    author_id: inserted.author_id,
    author_name: author.full_name || author.email,
    body: inserted.body,
    created_at: inserted.created_at,
  });
}

module.exports = { listComments, addComment, isInvolvedInInstance };
