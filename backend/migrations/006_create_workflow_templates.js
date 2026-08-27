exports.up = async function up(knex) {
  await knex.schema.createTable('workflow_templates', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.timestamps(true, true);

    table.index('tenant_id');
    table.unique(['tenant_id', 'id']);
  });

  await knex.schema.createTable('workflow_stages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('workflow_template_id').notNullable();
    table.integer('stage_order').notNullable();
    table.string('name').notNullable();
    table.enu('assignee_type', ['user', 'role'], { useNative: true, enumName: 'assignee_type' }).notNullable();
    table.uuid('assignee_user_id');
    table.uuid('assignee_role_id');
    table.jsonb('allowed_actions').notNullable().defaultTo(JSON.stringify(['forward', 'send_back', 'reject']));
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['workflow_template_id', 'stage_order']);
    table.index('tenant_id');
    table.index(['workflow_template_id', 'stage_order']);

    table
      .foreign(['tenant_id', 'workflow_template_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_templates')
      .onDelete('CASCADE');
    table.foreign(['tenant_id', 'assignee_user_id']).references(['tenant_id', 'id']).inTable('users');
    table.foreign(['tenant_id', 'assignee_role_id']).references(['tenant_id', 'id']).inTable('roles');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('workflow_stages');
  await knex.raw('DROP TYPE IF EXISTS assignee_type');
  await knex.schema.dropTableIfExists('workflow_templates');
};
