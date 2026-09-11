exports.up = async function up(knex) {
  await knex.schema.alterTable('workflow_templates', (table) => {
    table.boolean('is_adhoc').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_templates', (table) => {
    table.dropColumn('is_adhoc');
  });
};
