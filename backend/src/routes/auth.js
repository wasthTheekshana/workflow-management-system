const express = require('express');
const rateLimit = require('express-rate-limit');
const { login, requestPasswordReset, resetPassword } = require('../services/authService');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests, please try again later' },
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

router.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    await requestPasswordReset(email);
    return res.status(200).json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    return next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }
    await resetPassword(token, newPassword);
    return res.status(200).json({ message: 'Password has been reset.' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
