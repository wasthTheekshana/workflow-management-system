exports.up = async function up(knex) {
  await knex.schema.alterTable('document_types', (table) => {
    table.boolean('is_adhoc').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('template_files', (table) => {
    table.boolean('is_adhoc').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('template_files', (table) => {
    table.dropColumn('is_adhoc');
  });
  await knex.schema.alterTable('document_types', (table) => {
    table.dropColumn('is_adhoc');
  });
};
