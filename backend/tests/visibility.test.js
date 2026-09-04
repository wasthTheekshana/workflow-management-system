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

  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Visibility Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'vis-admin@example.com', password_hash: 'x', is_admin: true },
        { id: IT_USER_ID, tenant_id: TENANT_ID, email: 'vis-it1@example.com', password_hash: 'x' },
        { id: IT_USER2_ID, tenant_id: TENANT_ID, email: 'vis-it2@example.com', password_hash: 'x' },
        { id: OUTSIDER_ID, tenant_id: TENANT_ID, email: 'vis-outsider@example.com', password_hash: 'x' },
      ])
      .onConflict('id')
      .ignore();
    const [group] = await db('groups').insert({ tenant_id: TENANT_ID, name: 'IT Group' }).returning('id');
    itGroupId = group.id;
    await db('user_groups').insert([
      { tenant_id: TENANT_ID, user_id: IT_USER_ID, group_id: itGroupId },
      { tenant_id: TENANT_ID, user_id: IT_USER2_ID, group_id: itGroupId },
    ]);
  });

  afterAll(async () => {
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
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
});
