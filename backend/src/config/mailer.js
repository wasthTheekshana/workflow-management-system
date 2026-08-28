const nodemailer = require('nodemailer');
const { validateEnv } = require('./env');

const config = validateEnv();

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  // Implicit TLS (secure: true, port 465) already encrypts from connect;
  // otherwise require STARTTLS so a network attacker can't downgrade the
  // session to plaintext by stripping the upgrade.
  requireTLS: !config.smtp.secure && config.smtp.requireTLS,
  tls: { minVersion: 'TLSv1.2' },
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
});

module.exports = { transporter, MAIL_FROM: config.smtp.from };
