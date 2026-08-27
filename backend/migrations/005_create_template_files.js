exports.up = async function up(knex) {
  await knex.schema.createTable('template_files', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.timestamps(true, true);

    table.index('tenant_id');
  });

  await knex.schema.createTable('template_file_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('template_file_id').notNullable().references('id').inTable('template_files').onDelete('CASCADE');
    table.integer('version_number').notNullable();
    table.string('file_path').notNullable();
    table.uuid('uploaded_by').references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['template_file_id', 'version_number']);
    table.index('tenant_id');
    table.index('template_file_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('template_file_versions');
  await knex.schema.dropTableIfExists('template_files');
};
