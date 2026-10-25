require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000002';

const isProduction = process.env.NODE_ENV === 'production';

// Dev/test keep the well-known login. Production must supply its own, so a
// live server can never come up with a published default password.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || (isProduction ? '' : 'admin@dev.local');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (isProduction ? '' : 'ChangeMe123!');
const TENANT_NAME = process.env.TENANT_NAME || (isProduction ? 'DOK Solutions Lanka' : 'DOK Solutions Lanka (dev)');

async function seed() {
  if (isProduction && (!ADMIN_EMAIL || ADMIN_PASSWORD.length < 12)) {
    throw new Error('In production set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters');
  }

  await db('tenants').insert({ id: TENANT_ID, name: TENANT_NAME }).onConflict('id').ignore();

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await db('users')
    .insert({
      id: ADMIN_USER_ID,
      tenant_id: TENANT_ID,
      email: ADMIN_EMAIL,
      password_hash: passwordHash,
      full_name: isProduction ? 'Administrator' : 'Dev Admin',
      is_admin: true,
    })
    .onConflict('id')
    .ignore();

  // Never print the password in production logs.
  console.log(isProduction ? `Seed complete. Admin: ${ADMIN_EMAIL}` : `Seed complete. Login with ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  await db.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
