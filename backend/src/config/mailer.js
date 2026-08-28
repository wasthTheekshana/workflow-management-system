const nodemailer = require('nodemailer');
const { validateEnv } = require('./env');

const config = validateEnv();

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
});

module.exports = { transporter, MAIL_FROM: config.smtp.from };
