const db = require('../src/config/db');
const { notifyStage, notifyUser, TEMPLATES } = require('../src/services/notificationService');

const TENANT_ID = 'd0000000-0000-0000-0000-000000000001';
const USER_A = 'd0000000-0000-0000-0000-000000000002';
const USER_B = 'd0000000-0000-0000-0000-000000000003';
// notifications.workflow_instance_id is a composite (tenant_id, id) FK to
// workflow_instances; passing null exercises the notification content/recipient
// logic here without needing a real instance row.
const INSTANCE_ID = null;

describe('notificationService', () => {
  let roleId;
  let groupId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Notification Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: USER_A, tenant_id: TENANT_ID, email: 'notif-a@example.com', password_hash: 'x' },
        { id: USER_B, tenant_id: TENANT_ID, email: 'notif-b@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [role] = await db('roles').insert({ tenant_id: TENANT_ID, name: 'Reviewer' }).returning('id');
    roleId = role.id;
    await db('user_roles').insert([
      { tenant_id: TENANT_ID, user_id: USER_A, role_id: roleId },
      { tenant_id: TENANT_ID, user_id: USER_B, role_id: roleId },
    ]);
    const [group] = await db('groups').insert({ tenant_id: TENANT_ID, name: 'Notify Group' }).returning('id');
    groupId = group.id;
    await db('user_groups').insert([
      { tenant_id: TENANT_ID, user_id: USER_A, group_id: groupId },
      { tenant_id: TENANT_ID, user_id: USER_B, group_id: groupId },
    ]);
  });

  afterEach(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
  });

  afterAll(async () => {
    await db('user_roles').where({ tenant_id: TENANT_ID }).del();
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('roles').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('enqueues one notification for a user-assigned stage', async () => {
    const stage = { assignee_type: 'user', assignee_user_id: USER_A };
    await notifyStage(TENANT_ID, INSTANCE_ID, 'assigned', stage, {
      documentTypeName: 'SRS',
      stageName: 'Draft',
    });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_email).toBe('notif-a@example.com');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].subject).toBe(TEMPLATES.assigned({ documentTypeName: 'SRS', stageName: 'Draft' }).subject);
  });

  it('enqueues one notification per role-holder for a role-assigned stage', async () => {
    const stage = { assignee_type: 'role', assignee_role_id: roleId };
    await notifyStage(TENANT_ID, INSTANCE_ID, 'forwarded', stage, {
      documentTypeName: 'HR Letter',
      stageName: 'Review',
    });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID }).orderBy('recipient_email');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recipient_email)).toEqual(['notif-a@example.com', 'notif-b@example.com']);
  });

  it('enqueues one notification per member for a group-assigned stage', async () => {
    const stage = { assignee_type: 'group', assignee_group_id: groupId };
    await notifyStage(TENANT_ID, INSTANCE_ID, 'assigned', stage, {
      documentTypeName: 'IT Request',
      stageName: 'Triage',
    });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID }).orderBy('recipient_email');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recipient_email)).toEqual(['notif-a@example.com', 'notif-b@example.com']);
  });

  it('enqueues a notification for a specific user', async () => {
    await notifyUser(TENANT_ID, INSTANCE_ID, 'rejected', USER_A, { documentTypeName: 'SRS', comment: 'Bad format' });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_email).toBe('notif-a@example.com');
    expect(rows[0].body).toContain('Bad format');
  });

  it('does nothing when the target user does not exist', async () => {
    await notifyUser(TENANT_ID, INSTANCE_ID, 'completed', '99999999-9999-9999-9999-999999999999', {
      documentTypeName: 'SRS',
    });

    const rows = await db('notifications').where({ tenant_id: TENANT_ID });
    expect(rows).toHaveLength(0);
  });
});
