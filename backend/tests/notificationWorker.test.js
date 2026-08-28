const db = require('../src/config/db');
const { processPendingNotifications, MAX_ATTEMPTS } = require('../src/workers/notificationWorker');

const TENANT_ID = 'd2000000-0000-0000-0000-000000000001';

async function insertPendingNotification(overrides = {}) {
  const [row] = await db('notifications')
    .insert({
      tenant_id: TENANT_ID,
      recipient_email: 'worker-test@example.com',
      subject: 'Test subject',
      body: 'Test body',
      status: 'pending',
      ...overrides,
    })
    .returning('*');
  return row;
}

describe('processPendingNotifications', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Worker Test Tenant' }).onConflict('id').ignore();
  });

  afterEach(async () => {
    await db('notifications').where({ tenant_id: TENANT_ID }).del();
  });

  afterAll(async () => {
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('marks a notification sent when delivery succeeds', async () => {
    const notification = await insertPendingNotification();
    const sendMail = jest.fn().mockResolvedValue({});

    await processPendingNotifications(sendMail);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'worker-test@example.com', subject: 'Test subject' }),
    );
    const updated = await db('notifications').where({ id: notification.id }).first();
    expect(updated.status).toBe('sent');
  });

  it('retries on a simulated SMTP outage instead of dropping the notification', async () => {
    const notification = await insertPendingNotification();
    const failingSendMail = jest.fn().mockRejectedValue(new Error('ECONNREFUSED: simulated SMTP outage'));

    await processPendingNotifications(failingSendMail);

    const afterFirstFailure = await db('notifications').where({ id: notification.id }).first();
    expect(afterFirstFailure.status).toBe('pending');
    expect(afterFirstFailure.attempts).toBe(1);
    expect(afterFirstFailure.last_error).toContain('simulated SMTP outage');

    const recoveringSendMail = jest.fn().mockResolvedValue({});
    await processPendingNotifications(recoveringSendMail);

    const afterRecovery = await db('notifications').where({ id: notification.id }).first();
    expect(afterRecovery.status).toBe('sent');
  });

  it('marks a notification failed after MAX_ATTEMPTS consecutive failures', async () => {
    const notification = await insertPendingNotification();
    const failingSendMail = jest.fn().mockRejectedValue(new Error('persistent outage'));

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await processPendingNotifications(failingSendMail);
    }

    const finalRow = await db('notifications').where({ id: notification.id }).first();
    expect(finalRow.status).toBe('failed');
    expect(finalRow.attempts).toBe(MAX_ATTEMPTS);

    failingSendMail.mockClear();
    await processPendingNotifications(failingSendMail);
    expect(failingSendMail).not.toHaveBeenCalled();
  });

  it('ignores notifications that are not pending', async () => {
    await insertPendingNotification({ status: 'sent' });
    const sendMail = jest.fn().mockResolvedValue({});

    await processPendingNotifications(sendMail);

    expect(sendMail).not.toHaveBeenCalled();
  });
});
