exports.up = function up(knex) {
  return knex.schema.createTable('roles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.timestamps(true, true);

    table.unique(['tenant_id', 'name']);
    table.index('tenant_id');
    // Lets child tables enforce a composite (tenant_id, role_id) FK.
    table.unique(['tenant_id', 'id']);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('roles');
};
