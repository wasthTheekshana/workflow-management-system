// backend/src/routes/groups.js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { listVisibleGroups } = require('../services/visibilityService');

const router = express.Router();

router.use(authenticate);

router.get('/visible', async (req, res, next) => {
  try {
    res.status(200).json(await listVisibleGroups(req.user.tenantId, req.user.userId, req.user.isAdmin));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
