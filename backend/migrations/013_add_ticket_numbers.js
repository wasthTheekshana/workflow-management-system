exports.up = async function up(knex) {
  // NOTE: this migration runs the backfill UPDATE, the NOT NULL alter, and the
  // unique index build inside one transaction, which takes an ACCESS EXCLUSIVE
  // lock on workflow_instances for its duration. Fine at this project's current
  // scale (dev DB had single-digit row counts when this was written); if this
  // is ever run against a large production workflow_instances table, split it
  // into: (1) add the nullable column + trigger only, deploy so new rows
  // self-populate; (2) backfill existing rows in small batched transactions;
  // (3) CREATE UNIQUE INDEX CONCURRENTLY, then ADD CONSTRAINT ... USING INDEX;
  // (4) add a NOT VALID check constraint, VALIDATE it, then SET NOT NULL.
  await knex.schema.createTable('tenant_ticket_counters', (table) => {
    table.uuid('tenant_id').primary().references('id').inTable('tenants').onDelete('CASCADE');
    table.integer('next_number').notNullable().defaultTo(1);
  });

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.integer('ticket_number');
  });

  await knex.raw(`
    CREATE OR REPLACE FUNCTION assign_ticket_number()
    RETURNS TRIGGER AS $$
    DECLARE
      v_ticket INTEGER;
    BEGIN
      IF NEW.ticket_number IS NULL THEN
        INSERT INTO tenant_ticket_counters (tenant_id, next_number)
        VALUES (NEW.tenant_id, 2)
        ON CONFLICT (tenant_id)
        DO UPDATE SET next_number = tenant_ticket_counters.next_number + 1
        RETURNING next_number - 1 INTO v_ticket;
        NEW.ticket_number := v_ticket;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER workflow_instances_assign_ticket_number
    BEFORE INSERT ON workflow_instances
    FOR EACH ROW
    EXECUTE FUNCTION assign_ticket_number();
  `);

  // Backfill any pre-existing rows (inserted before this migration, so the
  // BEFORE INSERT trigger never ran for them) with sequential per-tenant
  // ticket numbers, ordered by creation time, before enforcing NOT NULL.
  await knex.raw(`
    UPDATE workflow_instances wi
    SET ticket_number = sub.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
      FROM workflow_instances
      WHERE ticket_number IS NULL
    ) sub
    WHERE wi.id = sub.id;
  `);

  // Seed/advance the per-tenant counters so the next trigger-assigned number
  // continues after whatever was just backfilled.
  // Depends on the backfill UPDATE above having already run in this same
  // migration — MAX(ticket_number) here must see every row already numbered,
  // or this would under-seed the counter and cause duplicate ticket numbers
  // on the next real insert. Do not reorder these two statements.
  await knex.raw(`
    INSERT INTO tenant_ticket_counters (tenant_id, next_number)
    SELECT tenant_id, MAX(ticket_number) + 1
    FROM workflow_instances
    GROUP BY tenant_id
    ON CONFLICT (tenant_id) DO UPDATE SET next_number = EXCLUDED.next_number;
  `);

  await knex.schema.alterTable('workflow_instances', (table) => {
    table.integer('ticket_number').notNullable().alter();
    table.unique(['tenant_id', 'ticket_number']);
  });
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS workflow_instances_assign_ticket_number ON workflow_instances');
  await knex.raw('DROP FUNCTION IF EXISTS assign_ticket_number');
  await knex.schema.alterTable('workflow_instances', (table) => {
    table.dropUnique(['tenant_id', 'ticket_number']);
    table.dropColumn('ticket_number');
  });
  await knex.schema.dropTableIfExists('tenant_ticket_counters');
};
