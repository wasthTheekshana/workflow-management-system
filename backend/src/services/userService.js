const db = require('../config/db');

async function listUsers(tenantId) {
  return db('users').where({ tenant_id: tenantId }).select('id', 'email', 'full_name', 'is_admin').orderBy('email');
}

module.exports = { listUsers };
