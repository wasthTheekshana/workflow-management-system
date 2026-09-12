// backend/tests/commentsSchema.test.js
const db = require('../src/config/db');

describe('comments table schema', () => {
  afterAll(async () => {
    await db.destroy();
  });

  it('has the expected columns and nullability', async () => {
    const hasTable = await db.schema.hasTable('comments');
    expect(hasTable).toBe(true);

    const columnInfo = await db('comments').columnInfo();
    expect(columnInfo.id.nullable).toBe(false);
    expect(columnInfo.tenant_id.nullable).toBe(false);
    expect(columnInfo.workflow_instance_id.nullable).toBe(false);
    expect(columnInfo.author_id.nullable).toBe(false);
    expect(columnInfo.body.nullable).toBe(false);
    expect(columnInfo.created_at.nullable).toBe(false);
  });
});
