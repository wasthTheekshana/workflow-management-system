const db = require('../config/db');
const { transporter, MAIL_FROM } = require('../config/mailer');

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

async function processPendingNotifications(sendMail = transporter.sendMail.bind(transporter)) {
  const pending = await db('notifications').where({ status: 'pending' }).orderBy('created_at', 'asc').limit(BATCH_SIZE);

  for (const notification of pending) {
    try {
      await sendMail({
        from: MAIL_FROM,
        to: notification.recipient_email,
        subject: notification.subject,
        text: notification.body,
      });
      await db('notifications').where({ id: notification.id }).update({ status: 'sent' });
    } catch (err) {
      const attempts = notification.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      await db('notifications').where({ id: notification.id }).update({
        attempts,
        status,
        last_error: err.message,
      });
    }
  }

  return pending.length;
}

function startNotificationWorker(intervalMs = 10000) {
  const timer = setInterval(() => {
    processPendingNotifications().catch((err) => {
      console.error('Notification worker error:', err.message);
    });
  }, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { processPendingNotifications, startNotificationWorker, MAX_ATTEMPTS };
