exports.up = function up(knex) {
  return knex.schema.createTable('document_types', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.uuid('template_file_id').notNullable();
    table.uuid('workflow_template_id').notNullable();
    table.jsonb('allowed_extensions').notNullable().defaultTo(JSON.stringify(['docx']));
    table.integer('max_upload_size_bytes').notNullable().defaultTo(10485760);
    table.timestamps(true, true);

    table.index('tenant_id');
    table.index('template_file_id');
    table.index('workflow_template_id');
    table.unique(['tenant_id', 'id']);

    table.foreign(['tenant_id', 'template_file_id']).references(['tenant_id', 'id']).inTable('template_files');
    table
      .foreign(['tenant_id', 'workflow_template_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_templates');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('document_types');
};
