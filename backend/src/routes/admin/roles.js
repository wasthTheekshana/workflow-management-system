const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { listRoles } = require('../../services/roleService');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const roles = await listRoles(req.user.tenantId);
    res.status(200).json(roles);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
