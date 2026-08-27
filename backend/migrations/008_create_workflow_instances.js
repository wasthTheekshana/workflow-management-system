exports.up = function up(knex) {
  return knex.schema.createTable('workflow_instances', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('document_type_id').notNullable().references('id').inTable('document_types');
    table.uuid('template_file_version_id').notNullable().references('id').inTable('template_file_versions');
    table.integer('current_stage_order').notNullable().defaultTo(1);
    table.string('status').notNullable().defaultTo('in_progress');
    table.uuid('claimed_by').references('id').inTable('users');
    table.uuid('created_by').notNullable().references('id').inTable('users');
    table.timestamps(true, true);

    table.index('tenant_id');
    table.index('document_type_id');
    table.index(['tenant_id', 'status']);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('workflow_instances');
};
