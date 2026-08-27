exports.up = function up(knex) {
  return knex.schema.createTable('user_roles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('user_id').notNullable();
    table.uuid('role_id').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id', 'role_id']);
    table.index('tenant_id');
    table.index('user_id');
    table.index('role_id');

    // Composite FKs tie the reference to the SAME tenant as this row,
    // so a user_role can never cross-link a user/role from another tenant.
    table.foreign(['tenant_id', 'user_id']).references(['tenant_id', 'id']).inTable('users').onDelete('CASCADE');
    table.foreign(['tenant_id', 'role_id']).references(['tenant_id', 'id']).inTable('roles').onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('user_roles');
};
