const { isUuid, assertUuid, assertRequiredString } = require('../src/utils/validation');

describe('isUuid', () => {
  it('accepts a well-formed UUID', () => {
    expect(isUuid('11111111-1111-1111-1111-111111111111')).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('assertUuid', () => {
  it('throws AppError(400) for a malformed value', () => {
    expect(() => assertUuid('bad-id', 'templateFileId')).toThrow('templateFileId must be a valid UUID');
  });

  it('does not throw for a valid UUID', () => {
    expect(() => assertUuid('11111111-1111-1111-1111-111111111111', 'templateFileId')).not.toThrow();
  });
});

describe('assertRequiredString', () => {
  it('throws for an empty string', () => {
    expect(() => assertRequiredString('', 'name')).toThrow('name is required');
  });

  it('throws for a whitespace-only string', () => {
    expect(() => assertRequiredString('   ', 'name')).toThrow('name is required');
  });

  it('does not throw for a non-empty string', () => {
    expect(() => assertRequiredString('SRS Template', 'name')).not.toThrow();
  });
});
