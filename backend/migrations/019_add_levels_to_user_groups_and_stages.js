exports.up = async function up(knex) {
  await knex.schema.alterTable('user_groups', (table) => {
    table.integer('level').notNullable().defaultTo(1);
    table.index(['tenant_id', 'group_id', 'level']);
  });

  await knex.schema.alterTable('workflow_stages', (table) => {
    table.integer('assignee_group_level').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_stages', (table) => {
    table.dropColumn('assignee_group_level');
  });

  await knex.schema.alterTable('user_groups', (table) => {
    table.dropIndex(['tenant_id', 'group_id', 'level']);
    table.dropColumn('level');
  });
};

