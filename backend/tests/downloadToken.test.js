const jwt = require('jsonwebtoken');
const { signDownloadToken, verifyDownloadToken } = require('../src/utils/downloadToken');
const { validateEnv } = require('../src/config/env');

describe('downloadToken', () => {
  it('round-trips a file path through sign and verify', () => {
    const token = signDownloadToken('tenant-1/some-file.docx');
    const { filePath } = verifyDownloadToken(token);
    expect(filePath).toBe('tenant-1/some-file.docx');
  });

  it('rejects a token signed with a different secret', () => {
    const tampered = jwt.sign({ filePath: 'x' }, 'a-completely-different-secret-value-here', {
      algorithm: 'HS256',
    });
    expect(() => verifyDownloadToken(tampered)).toThrow();
  });

  it('rejects an expired token', () => {
    const config = validateEnv();
    const expired = jwt.sign({ filePath: 'x' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: -10 });
    expect(() => verifyDownloadToken(expired)).toThrow();
  });
});
