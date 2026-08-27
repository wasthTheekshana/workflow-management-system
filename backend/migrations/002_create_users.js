exports.up = function up(knex) {
  return knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();
    table.string('full_name');
    table.boolean('is_admin').notNullable().defaultTo(false);
    table.timestamps(true, true);

    table.index('tenant_id');
    // Lets child tables enforce a composite (tenant_id, user_id) FK, so a
    // row can never reference a user belonging to a different tenant.
    table.unique(['tenant_id', 'id']);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('users');
};
