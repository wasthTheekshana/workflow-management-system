const jwt = require('jsonwebtoken');
const { signToken, verifyToken } = require('../src/utils/jwt');

describe('jwt utils', () => {
  it('round-trips a payload through sign and verify', () => {
    const token = signToken({ sub: 'user-1', tenant_id: 'tenant-1', is_admin: false });
    const payload = verifyToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.tenant_id).toBe('tenant-1');
    expect(payload.is_admin).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const tampered = jwt.sign({ sub: 'user-1' }, 'a-completely-different-secret-value-here', {
      algorithm: 'HS256',
    });
    expect(() => verifyToken(tampered)).toThrow();
  });

  it('rejects a malformed token', () => {
    expect(() => verifyToken('not-a-real-token')).toThrow();
  });
});
