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
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('users');
};
