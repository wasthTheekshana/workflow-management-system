exports.up = function up(knex) {
  return knex.schema.createTable('workflow_instances', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('document_type_id').notNullable();
    table.uuid('template_file_version_id').notNullable();
    table.integer('current_stage_order').notNullable().defaultTo(1);
    table.string('status').notNullable().defaultTo('in_progress');
    table.uuid('claimed_by');
    table.uuid('created_by').notNullable();
    table.timestamps(true, true);

    table.index('tenant_id');
    table.index('document_type_id');
    table.index(['tenant_id', 'status']);
    table.unique(['tenant_id', 'id']);

    table.foreign(['tenant_id', 'document_type_id']).references(['tenant_id', 'id']).inTable('document_types');
    table
      .foreign(['tenant_id', 'template_file_version_id'])
      .references(['tenant_id', 'id'])
      .inTable('template_file_versions');
    table.foreign(['tenant_id', 'claimed_by']).references(['tenant_id', 'id']).inTable('users');
    table.foreign(['tenant_id', 'created_by']).references(['tenant_id', 'id']).inTable('users');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('workflow_instances');
};
