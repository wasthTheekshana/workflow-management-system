exports.up = function up(knex) {
  return knex.schema
    .createTable('groups', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('name').notNullable();
      table.timestamps(true, true);

      table.unique(['tenant_id', 'name']);
      table.index('tenant_id');
      table.unique(['tenant_id', 'id']);
    })
    .createTable('user_groups', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.uuid('user_id').notNullable();
      table.uuid('group_id').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.unique(['user_id', 'group_id']);
      table.index('tenant_id');
      table.index('user_id');
      table.index('group_id');

      table.foreign(['tenant_id', 'user_id']).references(['tenant_id', 'id']).inTable('users').onDelete('CASCADE');
      table.foreign(['tenant_id', 'group_id']).references(['tenant_id', 'id']).inTable('groups').onDelete('CASCADE');
    });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('user_groups').dropTableIfExists('groups');
};
