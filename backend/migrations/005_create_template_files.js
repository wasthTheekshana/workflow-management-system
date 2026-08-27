exports.up = async function up(knex) {
  await knex.schema.createTable('template_files', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.timestamps(true, true);

    table.index('tenant_id');
    table.unique(['tenant_id', 'id']);
  });

  await knex.schema.createTable('template_file_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('template_file_id').notNullable();
    table.integer('version_number').notNullable();
    table.string('file_path').notNullable();
    table.uuid('uploaded_by');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['template_file_id', 'version_number']);
    table.index('tenant_id');
    table.index('template_file_id');
    table.unique(['tenant_id', 'id']);

    table
      .foreign(['tenant_id', 'template_file_id'])
      .references(['tenant_id', 'id'])
      .inTable('template_files')
      .onDelete('CASCADE');
    table.foreign(['tenant_id', 'uploaded_by']).references(['tenant_id', 'id']).inTable('users');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('template_file_versions');
  await knex.schema.dropTableIfExists('template_files');
};
