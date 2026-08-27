require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000002';
const ADMIN_EMAIL = 'admin@dev.local';
const ADMIN_PASSWORD = 'ChangeMe123!';

async function seed() {
  await db('tenants').insert({ id: TENANT_ID, name: 'DOK Solutions Lanka (dev)' }).onConflict('id').ignore();

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await db('users')
    .insert({
      id: ADMIN_USER_ID,
      tenant_id: TENANT_ID,
      email: ADMIN_EMAIL,
      password_hash: passwordHash,
      full_name: 'Dev Admin',
      is_admin: true,
    })
    .onConflict('id')
    .ignore();

  console.log(`Seed complete. Login with ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  await db.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
