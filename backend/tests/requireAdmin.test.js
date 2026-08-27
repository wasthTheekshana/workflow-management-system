const express = require('express');
const request = require('supertest');
const { authenticate } = require('../src/middleware/auth');
const { requireAdmin } = require('../src/middleware/requireAdmin');
const errorHandler = require('../src/middleware/errorHandler');
const { signToken } = require('../src/utils/jwt');

function buildTestApp() {
  const app = express();
  app.get('/admin-only', authenticate, requireAdmin, (req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('requireAdmin middleware', () => {
  const app = buildTestApp();

  it('rejects a non-admin user with 403', async () => {
    const token = signToken({ sub: 'user-1', tenant_id: 'tenant-1', is_admin: false });
    const response = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Admin privileges required' });
  });

  it('allows an admin user through', async () => {
    const token = signToken({ sub: 'user-1', tenant_id: 'tenant-1', is_admin: true });
    const response = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
  });
});
