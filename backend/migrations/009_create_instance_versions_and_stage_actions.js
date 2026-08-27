exports.up = async function up(knex) {
  await knex.schema.createTable('instance_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('workflow_instance_id').notNullable();
    table.integer('version_number').notNullable();
    table.string('file_path').notNullable();
    table.uuid('uploaded_by').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['workflow_instance_id', 'version_number']);
    table.index('tenant_id');
    table.index('workflow_instance_id');

    table
      .foreign(['tenant_id', 'workflow_instance_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.foreign(['tenant_id', 'uploaded_by']).references(['tenant_id', 'id']).inTable('users');
  });

  await knex.schema.createTable('stage_actions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('workflow_instance_id').notNullable();
    table.string('action_type').notNullable();
    table.integer('from_stage_order');
    table.integer('to_stage_order');
    table.uuid('actor_id').notNullable();
    table.text('comment');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('tenant_id');
    table.index('workflow_instance_id');

    table
      .foreign(['tenant_id', 'workflow_instance_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.foreign(['tenant_id', 'actor_id']).references(['tenant_id', 'id']).inTable('users');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('stage_actions');
  await knex.schema.dropTableIfExists('instance_versions');
};
