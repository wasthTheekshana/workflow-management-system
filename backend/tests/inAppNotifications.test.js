const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_A = 'd1000000-0000-0000-0000-000000000001';
const USER_A1 = 'd1000000-0000-0000-0000-000000000002';
const USER_A2 = 'd1000000-0000-0000-0000-000000000003';

const TENANT_B = 'd2000000-0000-0000-0000-000000000001';
const USER_B1 = 'd2000000-0000-0000-0000-000000000002';

const userA1Token = signToken({ sub: USER_A1, tenant_id: TENANT_A, is_admin: false });
const userA2Token = signToken({ sub: USER_A2, tenant_id: TENANT_A, is_admin: false });
const userB1Token = signToken({ sub: USER_B1, tenant_id: TENANT_B, is_admin: false });

describe('In-App Notification Center (/notifications)', () => {
  let notifA1_1;
  let notifA1_2;
  let notifA2_1;

  beforeAll(async () => {
    // Setup tenants
    await db('tenants').insert([
      { id: TENANT_A, name: 'Notification Tenant A' },
      { id: TENANT_B, name: 'Notification Tenant B' },
    ]).onConflict('id').ignore();

    // Setup users
    await db('users').insert([
      { id: USER_A1, tenant_id: TENANT_A, email: 'usera1@example.com', password_hash: 'x' },
      { id: USER_A2, tenant_id: TENANT_A, email: 'usera2@example.com', password_hash: 'x' },
      { id: USER_B1, tenant_id: TENANT_B, email: 'userb1@example.com', password_hash: 'x' },
    ]).onConflict('id').ignore();

    // Insert test notifications for USER_A1
    const [n1] = await db('notifications').insert({
      tenant_id: TENANT_A,
      recipient_user_id: USER_A1,
      recipient_email: 'usera1@example.com',
      subject: 'New task assigned',
      body: 'Document has been assigned to you',
      status: 'pending',
      is_read: false,
    }).returning('*');
    notifA1_1 = n1.id;

    const [n2] = await db('notifications').insert({
      tenant_id: TENANT_A,
      recipient_user_id: USER_A1,
      recipient_email: 'usera1@example.com',
      subject: 'Document approved',
      body: 'Document was approved',
      status: 'pending',
      is_read: false,
    }).returning('*');
    notifA1_2 = n2.id;

    // Insert test notification for USER_A2
    const [n3] = await db('notifications').insert({
      tenant_id: TENANT_A,
      recipient_user_id: USER_A2,
      recipient_email: 'usera2@example.com',
      subject: 'Task forwarded',
      body: 'Task forwarded to you',
      status: 'pending',
      is_read: false,
    }).returning('*');
    notifA2_1 = n3.id;
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(401);
  });

  it('returns unread count for the logged-in user', async () => {
    const res = await request(app)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${userA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(2);
  });

  it('lists notifications for the user with read status and timestamps', async () => {
    const res = await request(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userA1Token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('subject');
    expect(res.body[0]).toHaveProperty('body');
    expect(res.body[0].is_read).toBe(false);
  });

  it('marks a single notification as read', async () => {
    const res = await request(app)
      .patch(`/notifications/${notifA1_1}/read`)
      .set('Authorization', `Bearer ${userA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.is_read).toBe(true);
    expect(res.body.read_at).toBeTruthy();

    // Verify unread count decreased to 1
    const countRes = await request(app)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${userA1Token}`);
    expect(countRes.body.unreadCount).toBe(1);
  });

  it('prevents a user from marking another user\'s notification as read', async () => {
    const res = await request(app)
      .patch(`/notifications/${notifA2_1}/read`)
      .set('Authorization', `Bearer ${userA1Token}`);

    expect(res.status).toBe(404);
  });

  it('marks all notifications as read for the user', async () => {
    const res = await request(app)
      .post('/notifications/mark-all-read')
      .set('Authorization', `Bearer ${userA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1); // 1 was remaining unread

    const countRes = await request(app)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${userA1Token}`);
    expect(countRes.body.unreadCount).toBe(0);
  });

  it('maintains strict tenant isolation (Tenant B sees zero notifications)', async () => {
    const countRes = await request(app)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${userB1Token}`);
    expect(countRes.status).toBe(200);
    expect(countRes.body.unreadCount).toBe(0);

    const listRes = await request(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${userB1Token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(0);
  });

  afterAll(async () => {
    await db('notifications').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('users').whereIn('tenant_id', [TENANT_A, TENANT_B]).del();
    await db('tenants').whereIn('id', [TENANT_A, TENANT_B]).del();
  });
});

