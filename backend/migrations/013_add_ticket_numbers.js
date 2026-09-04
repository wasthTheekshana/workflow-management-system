exports.up = async function up(knex) {
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
