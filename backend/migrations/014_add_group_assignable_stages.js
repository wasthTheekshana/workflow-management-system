exports.up = async function up(knex) {
  // Postgres forbids using a newly-added enum value in the same transaction
  // that added it — this migration only adds the value and the column; no
  // DML anywhere in this file references 'group', so it's safe to run
  // together and the value is usable by the next request after this
  // migration commits.
  // ALTER TYPE ... ADD VALUE inside a transaction requires Postgres 12+.
  // (Knex wraps this migration in a transaction by default; the new value
  // is never referenced within this same migration, so PG 12+'s support for
  // adding-without-using-in-the-same-transaction is sufficient — PG 11 and
  // earlier would hard-error here.)
  await knex.raw("ALTER TYPE assignee_type ADD VALUE IF NOT EXISTS 'group'");

  await knex.schema.alterTable('workflow_stages', (table) => {
    table.uuid('assignee_group_id');
    table
      .foreign(['tenant_id', 'assignee_group_id'])
      .references(['tenant_id', 'id'])
      .inTable('groups');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_stages', (table) => {
    table.dropForeign(['tenant_id', 'assignee_group_id']);
    table.dropColumn('assignee_group_id');
  });
  // Postgres has no DROP VALUE for enums; removing 'group' from the type
  // would require rebuilding the enum (create new type, migrate column,
  // drop old type) and is not attempted here — down migrations in this
  // project are for local development rollback, not production reversal,
  // and a stray unused enum value is harmless.
};
