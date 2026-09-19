const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  listNotificationsForUser,
  getUnreadCountForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} = require('../services/notificationService');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const notifications = await listNotificationsForUser(req.user.tenantId, req.user.userId, {
      unreadOnly,
      limit,
    });
    res.status(200).json(notifications);
  } catch (err) {
    next(err);
  }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const unreadCount = await getUnreadCountForUser(req.user.tenantId, req.user.userId);
    res.status(200).json({ unreadCount });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const updated = await markNotificationAsRead(req.user.tenantId, req.user.userId, req.params.id);
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/mark-all-read', async (req, res, next) => {
  try {
    const result = await markAllNotificationsAsRead(req.user.tenantId, req.user.userId);
    res.status(200).json({ success: true, count: result.count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

