const db = require('../src/config/db');

describe('self-service documents schema', () => {
  afterAll(async () => {
    await db.destroy();
  });

  it('adds is_adhoc to document_types and template_files, defaulting to false', async () => {
    expect(await db.schema.hasColumn('document_types', 'is_adhoc')).toBe(true);
    expect(await db.schema.hasColumn('template_files', 'is_adhoc')).toBe(true);

    const documentTypeColumns = await db('document_types').columnInfo();
    expect(documentTypeColumns.is_adhoc.nullable).toBe(false);

    const templateFileColumns = await db('template_files').columnInfo();
    expect(templateFileColumns.is_adhoc.nullable).toBe(false);
  });
});
