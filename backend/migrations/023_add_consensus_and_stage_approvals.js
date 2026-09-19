exports.up = async function up(knex) {
  await knex.schema.alterTable('workflow_stages', (table) => {
    table.string('consensus_type', 20).notNullable().defaultTo('single');
  });

  await knex.schema.createTable('instance_stage_approvals', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('workflow_instance_id').notNullable();
    table.integer('stage_order').notNullable();
    table.uuid('user_id').notNullable();
    table.string('decision', 20).notNullable(); // 'approved', 'rejected'
    table.text('comment').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign(['tenant_id', 'workflow_instance_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table
      .foreign(['tenant_id', 'user_id'])
      .references(['tenant_id', 'id'])
      .inTable('users')
      .onDelete('CASCADE');

    table.unique(
      ['tenant_id', 'workflow_instance_id', 'stage_order', 'user_id'],
      'uq_stage_approvals_inst_stage_user',
    );
    table.index(
      ['tenant_id', 'workflow_instance_id', 'stage_order'],
      'idx_stage_approvals_inst_stage',
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('instance_stage_approvals');
  await knex.schema.alterTable('workflow_stages', (table) => {
    table.dropColumn('consensus_type');
  });
};

