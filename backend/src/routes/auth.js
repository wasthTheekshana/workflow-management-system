const express = require('express');
const rateLimit = require('express-rate-limit');
const { login } = require('../services/authService');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const result = await login(email, password);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
