exports.up = async function up(knex) {
  await knex.schema.alterTable('notifications', (table) => {
    table.boolean('is_read').notNullable().defaultTo(false);
    table.timestamp('read_at', { useTz: true }).nullable();
    table.uuid('recipient_user_id').nullable();

    table.index(['tenant_id', 'recipient_email', 'is_read']);
    table.index(['tenant_id', 'recipient_user_id', 'is_read']);

    table
      .foreign(['tenant_id', 'recipient_user_id'])
      .references(['tenant_id', 'id'])
      .inTable('users')
      .onDelete('CASCADE');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('notifications', (table) => {
    table.dropForeign(['tenant_id', 'recipient_user_id']);
    table.dropIndex(['tenant_id', 'recipient_user_id', 'is_read']);
    table.dropIndex(['tenant_id', 'recipient_email', 'is_read']);
    table.dropColumn('recipient_user_id');
    table.dropColumn('read_at');
    table.dropColumn('is_read');
  });
};

