const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'ad000000-0000-0000-0000-000000000001';
const ADMIN_ID = 'ad000000-0000-0000-0000-000000000002';
const NON_ADMIN_ID = 'ad000000-0000-0000-0000-000000000003';
const adminToken = signToken({ sub: ADMIN_ID, tenant_id: TENANT_ID, is_admin: true });
const nonAdminToken = signToken({ sub: NON_ADMIN_ID, tenant_id: TENANT_ID, is_admin: false });

describe('/admin/groups', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Admin Groups Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert([
        { id: ADMIN_ID, tenant_id: TENANT_ID, email: 'ag-admin@example.com', password_hash: 'x', is_admin: true },
        { id: NON_ADMIN_ID, tenant_id: TENANT_ID, email: 'ag-user@example.com', password_hash: 'x', is_admin: false },
      ])
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('user_groups').where({ tenant_id: TENANT_ID }).del();
    await db('groups').where({ tenant_id: TENANT_ID }).del();
    await db('users').where({ tenant_id: TENANT_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('rejects a non-admin', async () => {
    const response = await request(app).get('/admin/groups').set('Authorization', `Bearer ${nonAdminToken}`);
    expect(response.status).toBe(403);
  });

  it('creates, lists, updates membership, and deletes a group', async () => {
    const createRes = await request(app)
      .post('/admin/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'IT Group' });
    expect(createRes.status).toBe(201);
    const groupId = createRes.body.id;

    const listRes = await request(app).get('/admin/groups').set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((g) => g.id === groupId)).toBe(true);

    const addMemberRes = await request(app)
      .post(`/admin/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: NON_ADMIN_ID });
    expect(addMemberRes.status).toBe(204);

    const detailRes = await request(app).get(`/admin/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.members.map((m) => m.id)).toContain(NON_ADMIN_ID);

    const removeMemberRes = await request(app)
      .delete(`/admin/groups/${groupId}/members/${NON_ADMIN_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removeMemberRes.status).toBe(204);

    const renameRes = await request(app)
      .put(`/admin/groups/${groupId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'IT Team' });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.name).toBe('IT Team');

    const deleteRes = await request(app).delete(`/admin/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);
  });
});
