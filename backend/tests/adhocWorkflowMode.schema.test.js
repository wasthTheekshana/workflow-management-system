// backend/tests/adhocWorkflowMode.schema.test.js
const db = require('../src/config/db');

describe('ad-hoc workflow mode schema', () => {
  afterAll(async () => {
    await db.destroy();
  });

  it('adds workflow_mode to document_types, defaulting to predefined', async () => {
    const hasColumn = await db.schema.hasColumn('document_types', 'workflow_mode');
    expect(hasColumn).toBe(true);

    const columnInfo = await db('document_types').columnInfo();
    expect(columnInfo.workflow_mode.nullable).toBe(false);
    expect(String(columnInfo.workflow_template_id.nullable)).toBe('true');
  });

  it('adds a not-null workflow_template_id column to workflow_instances', async () => {
    const hasColumn = await db.schema.hasColumn('workflow_instances', 'workflow_template_id');
    expect(hasColumn).toBe(true);

    const columnInfo = await db('workflow_instances').columnInfo();
    expect(columnInfo.workflow_template_id.nullable).toBe(false);
  });
});
