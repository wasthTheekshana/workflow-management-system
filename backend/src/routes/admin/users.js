const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { listUsers } = require('../../services/userService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const users = await listUsers(req.user.tenantId);
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
