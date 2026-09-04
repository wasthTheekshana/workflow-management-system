// backend/src/routes/users.js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { listVisibleUsers } = require('../services/visibilityService');

const router = express.Router();

router.use(authenticate);

router.get('/visible', async (req, res, next) => {
  try {
    res.status(200).json(await listVisibleUsers(req.user.tenantId, req.user.userId, req.user.isAdmin));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
