const db = require('../config/db');

const TEMPLATES = {
  assigned: ({ documentTypeName, stageName }) => ({
    subject: `New task: ${documentTypeName} — ${stageName}`,
    body: `A new "${documentTypeName}" document has been assigned to you at the "${stageName}" stage.`,
  }),
  forwarded: ({ documentTypeName, stageName }) => ({
    subject: `Task forwarded to you: ${documentTypeName} — ${stageName}`,
    body: `"${documentTypeName}" has been forwarded to you at the "${stageName}" stage.`,
  }),
  sent_back: ({ documentTypeName, stageName }) => ({
    subject: `Task sent back: ${documentTypeName} — ${stageName}`,
    body: `"${documentTypeName}" has been sent back to you at the "${stageName}" stage.`,
  }),
  rejected: ({ documentTypeName, comment }) => ({
    subject: `Document rejected: ${documentTypeName}`,
    body: `Your "${documentTypeName}" submission was rejected.${comment ? ` Reason: ${comment}` : ''}`,
  }),
  completed: ({ documentTypeName }) => ({
    subject: `Workflow completed: ${documentTypeName}`,
    body: `Your "${documentTypeName}" submission has completed its workflow.`,
  }),
  reassigned: ({ documentTypeName, stageName }) => ({
    subject: `You've been assigned: ${documentTypeName} — ${stageName}`,
    body: `An admin has assigned you to act on "${documentTypeName}" at the "${stageName}" stage.`,
  }),
};

async function resolveStageRecipientEmails(tenantId, stage) {
  if (stage.assignee_type === 'user') {
    const user = await db('users').where({ tenant_id: tenantId, id: stage.assignee_user_id }).first();
    return user ? [user.email] : [];
  }

  const roleHolders = await db('user_roles')
    .join('users', 'users.id', 'user_roles.user_id')
    .where({ 'user_roles.tenant_id': tenantId, 'user_roles.role_id': stage.assignee_role_id })
    .select('users.email');
  return roleHolders.map((row) => row.email);
}

async function enqueueNotification(tenantId, workflowInstanceId, recipientEmail, subject, body) {
  await db('notifications').insert({
    tenant_id: tenantId,
    workflow_instance_id: workflowInstanceId,
    recipient_email: recipientEmail,
    subject,
    body,
    status: 'pending',
  });
}

async function notifyStage(tenantId, workflowInstanceId, templateName, stage, context) {
  const emails = await resolveStageRecipientEmails(tenantId, stage);
  const { subject, body } = TEMPLATES[templateName](context);
  await Promise.all(emails.map((email) => enqueueNotification(tenantId, workflowInstanceId, email, subject, body)));
}

async function notifyUser(tenantId, workflowInstanceId, templateName, userId, context) {
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    return;
  }
  const { subject, body } = TEMPLATES[templateName](context);
  await enqueueNotification(tenantId, workflowInstanceId, user.email, subject, body);
}

module.exports = { notifyStage, notifyUser, TEMPLATES };
