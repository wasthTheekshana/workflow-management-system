exports.up = function up(knex) {
  return knex.schema.createTable('password_reset_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('user_id').notNullable();
    table.text('token_hash').notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('token_hash');
    table.index(['tenant_id', 'user_id']);

    table
      .foreign(['tenant_id', 'user_id'])
      .references(['tenant_id', 'id'])
      .inTable('users')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('password_reset_tokens');
};
