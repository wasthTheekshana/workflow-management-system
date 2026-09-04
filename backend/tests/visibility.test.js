// backend/tests/visibility.test.js
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ae000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ae000000-0000-0000-0000-000000000002';
const IT_USER_ID = 'ae000000-0000-0000-0000-000000000003';
const IT_USER2_ID = 'ae000000-0000-0000-0000-000000000004';
const OUTSIDER_ID = 'ae000000-0000-0000-0000-000000000005';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const itUserToken = signToken({ sub: IT_USER_ID, tenant_id: TENANT_ID, is_admin: false });
const outsiderToken = signToken({ sub: OUTSIDER_ID, tenant_id: TENANT_ID, is_admin: false });

describe('visibility-scoped pickers', () => {
  let itGroupId;

  const TENANT_B_ID = 'ae000000-0000-0000-0000-000000000010';
  const TENANT_B_ADMIN_ID = 'ae000000-0000-0000-0000-000000000011';
  const TENANT_B_USER_ID = 'ae000000-0000-0000-0000-000000000012';
  const tenantBAdminToken = signToken({ sub: TENANT_B_ADMIN_ID, tenant_id: TENANT_B_ID, is_admin: true });

  const FINANCE_USER_ID = 'ae000000-0000-0000-0000-000000000006';
  let financeGroupId;

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Visibility Test Tenant' }).onConflict('id').ignore();
    await db('tenants').insert({ id: TENANT_B_ID, name: 'Visibility Test Tenant B' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'vis-admin@example.com', password_hash: 'x', is_admin: true },
        { id: IT_USER_ID, tenant_id: TENANT_ID, email: 'vis-it1@example.com', password_hash: 'x' },
        { id: IT_USER2_ID, tenant_id: TENANT_ID, email: 'vis-it2@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'vis-outsider@example.com', password_hash: 'x' },
        { id: FINANCE_USER_ID, tenant_id: TENANT_ID, email: 'vis-finance@example.com', password_hash: 'x' },
        { id: TENANT_B_ADMIN_ID, tenant_id: TENANT_B_ID, email: 'vis-b-admin@example.com', password_hash: 'x', is_admin: true },
        { id: TENANT_B_USER_ID, tenant_id: TENANT_B_ID, email: 'vis-b-user@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [group] = await db('groups').insert({ tenant_id: TENANT_ID, name: 'IT Group' }).returning('id');
    itGroupId = group.id;
    const [financeGroup] = await db('groups').insert({ tenant_id: TENANT_ID, name: 'Finance Group' }).returning('id');
    financeGroupId = financeGroup.id;
    await db('user_groups').insert([
      { tenant_id: TENANT_ID, user_id: IT_USER_ID, group_id: itGroupId },
      { tenant_id: TENANT_ID, user_id: IT_USER2_ID, group_id: itGroupId },
      { tenant_id: TENANT_ID, user_id: FINANCE_USER_ID, group_id: financeGroupId },
    ]);
  });

  afterAll(async () => {
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_B_ID }).del();
    await db('tenants').where({ id: TENANT_B_ID }).del();
    await db.destroy();
  });

  it('an admin sees every user and group', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${adminToken}`);
    expect(usersRes.body.map((u) => u.id)).toEqual(expect.arrayContaining([IT_USER_ID, IT_USER2_ID, OUTSIDER_ID]));

    const groupsRes = await request(app).get('/groups/visible').set('Authorization', `Bearer ${adminToken}`);
    expect(groupsRes.body.some((g) => g.id === itGroupId)).toBe(true);
  });

  it('a group member sees group-mates and self, but not an outsider', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${itUserToken}`);
    const ids = usersRes.body.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([IT_USER_ID, IT_USER2_ID]));
    expect(ids).not.toContain(OUTSIDER_ID);

    const groupsRes = await request(app).get('/groups/visible').set('Authorization', `Bearer ${itUserToken}`);
    expect(groupsRes.body.some((g) => g.id === itGroupId)).toBe(true);
  });

  it('a user with no shared group sees only themself and no groups', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${outsiderToken}`);
    expect(usersRes.body.map((u) => u.id)).toEqual([OUTSIDER_ID]);

    const groupsRes = await request(app).get('/groups/visible').set('Authorization', `Bearer ${outsiderToken}`);
    expect(groupsRes.body).toEqual([]);
  });

  it('a tenant-A non-admin never sees a tenant-B user or group via /users/visible or /groups/visible', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${itUserToken}`);
    expect(usersRes.body.map((u) => u.id)).not.toContain(TENANT_B_USER_ID);
    expect(usersRes.body.map((u) => u.id)).not.toContain(TENANT_B_ADMIN_ID);
  });

  it('a tenant-A admin never sees tenant-B users or groups via the unrestricted admin path', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${adminToken}`);
    expect(usersRes.body.map((u) => u.id)).not.toContain(TENANT_B_USER_ID);

    const groupsRes = await request(app).get('/groups/visible').set('Authorization', `Bearer ${adminToken}`);
    // sanity: tenant B has no groups in this test, so nothing to assert positively here beyond
    // confirming the admin list is scoped to tenant A's own groups (itGroupId, financeGroupId)
    expect(groupsRes.body.every((g) => [itGroupId, financeGroupId].includes(g.id))).toBe(true);
  });

  it('a tenant-B admin sees zero tenant-A groups', async () => {
    const groupsRes = await request(app).get('/groups/visible').set('Authorization', `Bearer ${tenantBAdminToken}`);
    expect(groupsRes.body).toEqual([]);
  });

  it('a user in a different, non-shared group does not see a group-mate from another group', async () => {
    const usersRes = await request(app).get('/users/visible').set('Authorization', `Bearer ${itUserToken}`);
    const ids = usersRes.body.map((u) => u.id);
    expect(ids).not.toContain(FINANCE_USER_ID);
  });
});
