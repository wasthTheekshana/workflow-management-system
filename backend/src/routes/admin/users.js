const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { listUsers, createUser } = require('../../services/userService');

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

router.post('/', async (req, res, next) => {
  try {
    const user = await createUser(req.user.tenantId, {
      email: req.body.email,
      password: req.body.password,
      fullName: req.body.fullName,
      isAdmin: req.body.isAdmin,
    });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
