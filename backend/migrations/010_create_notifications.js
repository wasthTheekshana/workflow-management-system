exports.up = function up(knex) {
  return knex.schema.createTable('notifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table
      .uuid('workflow_instance_id')
      .references('id')
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.string('recipient_email').notNullable();
    table.string('subject').notNullable();
    table.text('body').notNullable();
    table.string('status').notNullable().defaultTo('pending');
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('last_error');
    table.timestamps(true, true);

    table.index('tenant_id');
    table.index('status');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('notifications');
};
