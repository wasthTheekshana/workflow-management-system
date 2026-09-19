const db = require('../config/db');
const AppError = require('../utils/AppError');

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
  commented: ({ documentTypeName, authorName }) => ({
    subject: `New comment: ${documentTypeName}`,
    body: `${authorName} commented on "${documentTypeName}".`,
  }),
  cancelled: ({ documentTypeName, comment }) => ({
    subject: `Workflow cancelled: ${documentTypeName}`,
    body: `The "${documentTypeName}" workflow has been cancelled.${comment ? ` Reason: ${comment}` : ''}`,
  }),
};

async function resolveStageRecipientEmails(tenantId, stage) {
  if (stage.assignee_type === 'user') {
    const user = await db('users').where({ tenant_id: tenantId, id: stage.assignee_user_id }).first();
    return user ? [{ email: user.email, userId: user.id }] : [];
  }

  if (stage.assignee_type === 'group') {
    const query = db('user_groups')
      .join('users', 'users.id', 'user_groups.user_id')
      .where({ 'user_groups.tenant_id': tenantId, 'user_groups.group_id': stage.assignee_group_id });
    if (stage.assignee_group_level) {
      query.andWhere('user_groups.level', stage.assignee_group_level);
    }
    const members = await query.select('users.email', 'users.id as userId');
    return members.map((row) => ({ email: row.email, userId: row.userId }));
  }

  if (stage.assignee_type === 'role') {
    const roleHolders = await db('user_roles')
      .join('users', 'users.id', 'user_roles.user_id')
      .where({ 'user_roles.tenant_id': tenantId, 'user_roles.role_id': stage.assignee_role_id })
      .select('users.email', 'users.id as userId');
    return roleHolders.map((row) => ({ email: row.email, userId: row.userId }));
  }

  return [];
}

async function enqueueNotification(tenantId, workflowInstanceId, recipientEmail, subject, body, recipientUserId = null) {
  await db('notifications').insert({
    tenant_id: tenantId,
    workflow_instance_id: workflowInstanceId,
    recipient_email: recipientEmail,
    recipient_user_id: recipientUserId || null,
    subject,
    body,
    status: 'pending',
    is_read: false,
  });
}

async function notifyStage(tenantId, workflowInstanceId, templateName, stage, context) {
  const recipients = await resolveStageRecipientEmails(tenantId, stage);
  const { subject, body } = TEMPLATES[templateName](context);
  await Promise.all(
    recipients.map((r) =>
      enqueueNotification(tenantId, workflowInstanceId, r.email, subject, body, r.userId)
    )
  );
}

async function notifyUser(tenantId, workflowInstanceId, templateName, userId, context) {
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    return;
  }
  const { subject, body } = TEMPLATES[templateName](context);
  await enqueueNotification(tenantId, workflowInstanceId, user.email, subject, body, user.id);
}

async function notifyEmails(tenantId, workflowInstanceId, templateName, emails, context) {
  const { subject, body } = TEMPLATES[templateName](context);
  await Promise.all(
    emails.map((email) => enqueueNotification(tenantId, workflowInstanceId, email, subject, body, null))
  );
}

/**
 * List in-app notifications for the logged-in user.
 */
async function listNotificationsForUser(tenantId, userId, options = {}) {
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    return [];
  }

  const query = db('notifications')
    .leftJoin('workflow_instances', 'workflow_instances.id', 'notifications.workflow_instance_id')
    .leftJoin('document_types', 'document_types.id', 'workflow_instances.document_type_id')
    .where('notifications.tenant_id', tenantId)
    .where((builder) => {
      builder
        .where('notifications.recipient_user_id', userId)
        .orWhere('notifications.recipient_email', user.email);
    })
    .select(
      'notifications.id',
      'notifications.tenant_id',
      'notifications.workflow_instance_id',
      'notifications.recipient_email',
      'notifications.subject',
      'notifications.body',
      'notifications.is_read',
      'notifications.read_at',
      'notifications.created_at',
      'workflow_instances.ticket_number',
      'document_types.name as document_type_name'
    )
    .orderBy('notifications.created_at', 'desc')
    .limit(options.limit || 50);

  if (options.unreadOnly) {
    query.where('notifications.is_read', false);
  }

  return query;
}

/**
 * Get count of unread notifications for the user.
 */
async function getUnreadCountForUser(tenantId, userId) {
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    return 0;
  }

  const [row] = await db('notifications')
    .where('tenant_id', tenantId)
    .where('is_read', false)
    .where((builder) => {
      builder
        .where('recipient_user_id', userId)
        .orWhere('recipient_email', user.email);
    })
    .count('id as count');

  return Number(row?.count || 0);
}

/**
 * Mark a single notification as read.
 */
async function markNotificationAsRead(tenantId, userId, notificationId) {
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    throw new AppError(404, 'User not found');
  }

  const notification = await db('notifications')
    .where({ tenant_id: tenantId, id: notificationId })
    .where((builder) => {
      builder
        .where('recipient_user_id', userId)
        .orWhere('recipient_email', user.email);
    })
    .first();

  if (!notification) {
    throw new AppError(404, 'Notification not found');
  }

  const [updated] = await db('notifications')
    .where({ tenant_id: tenantId, id: notificationId })
    .update({
      is_read: true,
      read_at: db.fn.now(),
    })
    .returning('*');

  return updated;
}

/**
 * Mark all notifications for the user as read.
 */
async function markAllNotificationsAsRead(tenantId, userId) {
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    return { count: 0 };
  }

  const count = await db('notifications')
    .where('tenant_id', tenantId)
    .where('is_read', false)
    .where((builder) => {
      builder
        .where('recipient_user_id', userId)
        .orWhere('recipient_email', user.email);
    })
    .update({
      is_read: true,
      read_at: db.fn.now(),
    });

  return { count };
}

module.exports = {
  notifyStage,
  notifyUser,
  notifyEmails,
  resolveStageRecipientEmails,
  listNotificationsForUser,
  getUnreadCountForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  TEMPLATES,
};
