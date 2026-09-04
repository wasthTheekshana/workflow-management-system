// backend/tests/groupService.test.js
const db = require('../src/config/db');
const AppError = require('../src/utils/AppError');
const {
  listGroups,
  createGroup,
  getGroupWithMembers,
  renameGroup,
  deleteGroup,
  addMember,
  removeMember,
} = require('../src/services/groupService');

const TENANT_ID = 'ac000000-0000-0000-0000-000000000001';
const OTHER_TENANT_ID = 'ac000000-0000-0000-0000-000000000099';
const USER_ID = 'ac000000-0000-0000-0000-000000000002';

describe('groupService', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Group Service Test Tenant' }).onConflict('id').ignore();
    await db('tenants').insert({ id: OTHER_TENANT_ID, name: 'Other Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({ id: USER_ID, tenant_id: TENANT_ID, email: 'gs-user@example.com', password_hash: 'x' })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').whereIn('tenant_id', [TENANT_ID, OTHER_TENANT_ID]).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').whereIn('id', [TENANT_ID, OTHER_TENANT_ID]).del();
    await db.destroy();
  });

  it('creates, lists, renames, and deletes a group', async () => {
    const created = await createGroup(TENANT_ID, 'IT Group');
    expect(created.name).toBe('IT Group');

    const listed = await listGroups(TENANT_ID);
    expect(listed.find((g) => g.id === created.id)).toBeTruthy();

    const renamed = await renameGroup(TENANT_ID, created.id, 'IT Team');
    expect(renamed.name).toBe('IT Team');

    await deleteGroup(TENANT_ID, created.id);
    const afterDelete = await listGroups(TENANT_ID);
    expect(afterDelete.find((g) => g.id === created.id)).toBeUndefined();
  });

  it('adds and removes members, reflected in getGroupWithMembers', async () => {
    const group = await createGroup(TENANT_ID, 'Finance Group');

    await addMember(TENANT_ID, group.id, USER_ID);
    const withMember = await getGroupWithMembers(TENANT_ID, group.id);
    expect(withMember.members.map((m) => m.id)).toContain(USER_ID);

    await removeMember(TENANT_ID, group.id, USER_ID);
    const withoutMember = await getGroupWithMembers(TENANT_ID, group.id);
    expect(withoutMember.members.map((m) => m.id)).not.toContain(USER_ID);
  });

  it('rejects adding a user from a different tenant', async () => {
    const group = await createGroup(TENANT_ID, 'Cross-Tenant Test Group');
    await expect(addMember(TENANT_ID, group.id, 'ac000000-0000-0000-0000-000000000999')).rejects.toThrow(AppError);
  });

  it('throws 404 for a group in another tenant', async () => {
    const group = await createGroup(OTHER_TENANT_ID, 'Other Tenant Group');
    await expect(getGroupWithMembers(TENANT_ID, group.id)).rejects.toThrow(AppError);
  });
});
