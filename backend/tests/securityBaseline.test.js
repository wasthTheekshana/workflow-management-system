const request = require('supertest');
const app = require('../src/app');

describe('security baseline', () => {
  it('sets standard security headers via helmet', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('returns a generic 404 body for unknown routes', async () => {
    const response = await request(app).get('/no-such-route');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
  });
});
