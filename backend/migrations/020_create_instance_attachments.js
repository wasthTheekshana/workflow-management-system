exports.up = async function up(knex) {
  await knex.schema.createTable('instance_attachments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('workflow_instance_id').notNullable();
    table.string('file_name').notNullable();
    table.string('file_path').notNullable();
    table.integer('file_size_bytes').notNullable();
    table.string('mime_type');
    table.uuid('uploaded_by').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('tenant_id');
    table.index('workflow_instance_id');

    table
      .foreign(['tenant_id', 'workflow_instance_id'])
      .references(['tenant_id', 'id'])
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.foreign(['tenant_id', 'uploaded_by']).references(['tenant_id', 'id']).inTable('users');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('instance_attachments');
};

