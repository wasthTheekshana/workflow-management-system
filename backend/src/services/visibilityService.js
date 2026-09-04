// backend/src/services/visibilityService.js
const db = require('../config/db');

async function listVisibleUsers(tenantId, userId, isAdmin) {
  if (isAdmin) {
    return db('users').where({ tenant_id: tenantId }).select('id', 'email', 'full_name').orderBy('email');
  }

  const sharedGroupIds = (
    await db('user_groups').where({ tenant_id: tenantId, user_id: userId }).select('group_id')
  ).map((row) => row.group_id);

  if (sharedGroupIds.length === 0) {
    return db('users').where({ tenant_id: tenantId, id: userId }).select('id', 'email', 'full_name');
  }

  const groupMateIds = (
    await db('user_groups')
      .where({ tenant_id: tenantId })
      .whereIn('group_id', sharedGroupIds)
      .distinct('user_id')
  ).map((row) => row.user_id);

  const visibleIds = Array.from(new Set([userId, ...groupMateIds]));

  return db('users').where({ tenant_id: tenantId }).whereIn('id', visibleIds).select('id', 'email', 'full_name').orderBy('email');
}

async function listVisibleGroups(tenantId, userId, isAdmin) {
  if (isAdmin) {
    return db('groups').where({ tenant_id: tenantId }).select('id', 'name').orderBy('name');
  }

  return db('groups')
    .join('user_groups', 'user_groups.group_id', 'groups.id')
    .where({ 'groups.tenant_id': tenantId, 'user_groups.tenant_id': tenantId, 'user_groups.user_id': userId })
    .select('groups.id', 'groups.name')
    .orderBy('groups.name');
}

module.exports = { listVisibleUsers, listVisibleGroups };
