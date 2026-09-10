exports.up = async function up(knex) {
  await knex.raw("CREATE TYPE document_type_workflow_mode AS ENUM ('predefined', 'adhoc')");

  await knex.schema.alterTable('document_types', (table) => {
    table
      .specificType('workflow_mode', 'document_type_workflow_mode')
      .notNullable()
      .defaultTo('predefined');
  });

  // Postgres composite FKs use MATCH SIMPLE by default: a row is exempt from
  // the constraint if ANY column in the FK is NULL, so relaxing this column
  // to nullable does not require touching the existing
  // (tenant_id, workflow_template_id) -> workflow_templates(tenant_id, id) FK.
  await knex.schema.alterTable('document_types', (table) => {
    table.uuid('workflow_template_id').nullable().alter();
  });

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.uuid('workflow_template_id');
  });

  // Backfill every existing instance from its document type's (until-now
  // fixed) workflow template, since all existing rows are implicitly
  // 'predefined' (the enum default set above).
  await knex.raw(`
    UPDATE workflow_instances wi
    SET workflow_template_id = dt.workflow_template_id
    FROM document_types dt
    WHERE dt.id = wi.document_type_id
      AND dt.tenant_id = wi.tenant_id
      AND wi.workflow_template_id IS NULL
  `);

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.uuid('workflow_template_id').notNullable().alter();
    table
      .foreign(['tenant_id', 'workflow_template_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_templates');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_instances', (table) => {
    table.dropForeign(['tenant_id', 'workflow_template_id']);
    table.dropColumn('workflow_template_id');
  });
  await knex.schema.alterTable('document_types', (table) => {
    table.uuid('workflow_template_id').notNullable().alter();
    table.dropColumn('workflow_mode');
  });
  await knex.raw('DROP TYPE IF EXISTS document_type_workflow_mode');
};
