exports.up = function up(knex) {
  return knex.schema.createTable('user_roles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id', 'role_id']);
    table.index('tenant_id');
    table.index('user_id');
    table.index('role_id');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('user_roles');
};
