const express = require('express');
const request = require('supertest');
const { authenticate } = require('../src/middleware/auth');
const errorHandler = require('../src/middleware/errorHandler');
const { signToken } = require('../src/utils/jwt');

function buildTestApp() {
  const app = express();
  app.get('/protected', authenticate, (req, res) => {
    res.status(200).json({ user: req.user });
  });
  app.use(errorHandler);
  return app;
}

describe('authenticate middleware', () => {
  const app = buildTestApp();

  it('rejects requests with no authorization header', async () => {
    const response = await request(app).get('/protected');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Missing or invalid authorization header' });
  });

  it('rejects a malformed authorization header', async () => {
    const response = await request(app).get('/protected').set('Authorization', 'Token abc123');
    expect(response.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const response = await request(app).get('/protected').set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid or expired token' });
  });

  it('accepts a valid bearer token and attaches req.user', async () => {
    const token = signToken({ sub: 'user-1', tenant_id: 'tenant-1', is_admin: true });
    const response = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ userId: 'user-1', tenantId: 'tenant-1', isAdmin: true });
  });
});
