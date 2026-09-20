const db = require('../src/config/db');

describe('password_reset_tokens schema', () => {
  afterAll(async () => {
    await db.destroy();
  });

  it('creates the password_reset_tokens table with the expected columns', async () => {
    expect(await db.schema.hasTable('password_reset_tokens')).toBe(true);

    const columns = await db('password_reset_tokens').columnInfo();
    expect(columns.tenant_id.nullable).toBe(false);
    expect(columns.user_id.nullable).toBe(false);
    expect(columns.token_hash.nullable).toBe(false);
    expect(columns.expires_at.nullable).toBe(false);
    expect(columns.used_at.nullable).toBe(true);
  });
});
