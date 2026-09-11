const db = require('../config/db');
const AppError = require('../utils/AppError');
const { assertUuid, assertRequiredString } = require('../utils/validation');

async function listGroups(tenantId) {
  const groups = await db('groups').where({ tenant_id: tenantId }).select('id', 'name').orderBy('name');
  const counts = await db('user_groups')
    .where({ tenant_id: tenantId })
    .groupBy('group_id')
    .select('group_id')
    .count('* as count');
  const countByGroupId = new Map(counts.map((row) => [row.group_id, Number(row.count)]));
  return groups.map((group) => ({ ...group, memberCount: countByGroupId.get(group.id) || 0 }));
}

async function createGroup(tenantId, name) {
  assertRequiredString(name, 'name');
  try {
    const [group] = await db('groups').insert({ tenant_id: tenantId, name }).returning(['id', 'name']);
    return group;
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError(400, 'A group with that name already exists');
    }
    throw err;
  }
}

async function requireGroup(tenantId, groupId) {
  assertUuid(groupId, 'groupId');
  const group = await db('groups').where({ tenant_id: tenantId, id: groupId }).first();
  if (!group) {
    throw new AppError(404, 'Group not found');
  }
  return group;
}

async function getGroupWithMembers(tenantId, groupId) {
  const group = await requireGroup(tenantId, groupId);
  const members = await db('user_groups')
    .join('users', 'users.id', 'user_groups.user_id')
    .where({ 'user_groups.tenant_id': tenantId, 'user_groups.group_id': groupId })
    .select('users.id', 'users.email', 'users.full_name')
    .orderBy('users.email');
  return { ...group, members };
}

async function renameGroup(tenantId, groupId, name) {
  await requireGroup(tenantId, groupId);
  assertRequiredString(name, 'name');
  try {
    const [updated] = await db('groups')
      .where({ tenant_id: tenantId, id: groupId })
      .update({ name })
      .returning(['id', 'name']);
    return updated;
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError(400, 'A group with that name already exists');
    }
    throw err;
  }
}

async function deleteGroup(tenantId, groupId) {
  await requireGroup(tenantId, groupId);

  await db.transaction(async (trx) => {
    const stageUsingGroup = await trx('workflow_stages')
      .join('workflow_templates', function joinTemplate() {
        this.on('workflow_templates.tenant_id', '=', 'workflow_stages.tenant_id').andOn(
          'workflow_templates.id',
          '=',
          'workflow_stages.workflow_template_id',
        );
      })
      .where({
        'workflow_stages.tenant_id': tenantId,
        'workflow_stages.assignee_group_id': groupId,
        'workflow_templates.is_adhoc': false,
      })
      .first();
    if (stageUsingGroup) {
      throw new AppError(409, 'Group is assigned to one or more workflow stages and cannot be deleted');
    }

    // Any remaining stage rows referencing this group must belong to
    // ad-hoc (one-off, never-reused) templates, per the check above — null
    // out the reference so the FK doesn't block deletion; the historical
    // stage record itself is untouched otherwise.
    await trx('workflow_stages')
      .where({ tenant_id: tenantId, assignee_group_id: groupId })
      .update({ assignee_group_id: null });

    await trx('groups').where({ tenant_id: tenantId, id: groupId }).del();
  });
}

async function addMember(tenantId, groupId, userId) {
  await requireGroup(tenantId, groupId);
  assertUuid(userId, 'userId');
  const user = await db('users').where({ tenant_id: tenantId, id: userId }).first();
  if (!user) {
    throw new AppError(400, 'userId does not belong to this tenant');
  }
  await db('user_groups').insert({ tenant_id: tenantId, user_id: userId, group_id: groupId }).onConflict(['user_id', 'group_id']).ignore();
}

async function removeMember(tenantId, groupId, userId) {
  await requireGroup(tenantId, groupId);
  assertUuid(userId, 'userId');
  await db('user_groups').where({ tenant_id: tenantId, group_id: groupId, user_id: userId }).del();
}

module.exports = {
  listGroups,
  createGroup,
  getGroupWithMembers,
  renameGroup,
  deleteGroup,
  addMember,
  removeMember,
};
