exports.up = async function up(knex) {
  await knex.schema.alterTable('template_files', (table) => {
    table.string('content_format').notNullable().defaultTo('docx');
  });
  await knex.raw(
    "ALTER TABLE template_files ADD CONSTRAINT template_files_content_format_check CHECK (content_format IN ('docx', 'richtext'))",
  );

  await knex.schema.alterTable('template_file_versions', (table) => {
    table.jsonb('content').nullable();
  });
  await knex.raw('ALTER TABLE template_file_versions ALTER COLUMN file_path DROP NOT NULL');
  await knex.raw(`
    ALTER TABLE template_file_versions
    ADD CONSTRAINT template_file_versions_exactly_one_payload
    CHECK ((file_path IS NOT NULL) <> (content IS NOT NULL))
  `);

  await knex.schema.alterTable('instance_versions', (table) => {
    table.jsonb('content').nullable();
  });
  await knex.raw('ALTER TABLE instance_versions ALTER COLUMN file_path DROP NOT NULL');
  await knex.raw(`
    ALTER TABLE instance_versions
    ADD CONSTRAINT instance_versions_exactly_one_payload
    CHECK ((file_path IS NOT NULL) <> (content IS NOT NULL))
  `);
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE instance_versions DROP CONSTRAINT IF EXISTS instance_versions_exactly_one_payload');
  await knex.raw('ALTER TABLE instance_versions ALTER COLUMN file_path SET NOT NULL');
  await knex.schema.alterTable('instance_versions', (table) => {
    table.dropColumn('content');
  });

  await knex.raw(
    'ALTER TABLE template_file_versions DROP CONSTRAINT IF EXISTS template_file_versions_exactly_one_payload',
  );
  await knex.raw('ALTER TABLE template_file_versions ALTER COLUMN file_path SET NOT NULL');
  await knex.schema.alterTable('template_file_versions', (table) => {
    table.dropColumn('content');
  });

  await knex.raw('ALTER TABLE template_files DROP CONSTRAINT IF EXISTS template_files_content_format_check');
  await knex.schema.alterTable('template_files', (table) => {
    table.dropColumn('content_format');
  });
};
