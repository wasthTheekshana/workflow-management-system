exports.up = async function up(knex) {
  await knex.schema.alterTable('workflow_stages', (table) => {
    table.integer('sla_hours').nullable();
  });

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.timestamp('stage_entered_at', { useTz: true }).nullable().defaultTo(knex.fn.now());
    table.timestamp('stage_due_at', { useTz: true }).nullable();
    table.index(['tenant_id', 'stage_due_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_instances', (table) => {
    table.dropIndex(['tenant_id', 'stage_due_at']);
    table.dropColumn('stage_due_at');
    table.dropColumn('stage_entered_at');
  });

  await knex.schema.alterTable('workflow_stages', (table) => {
    table.dropColumn('sla_hours');
  });
};

