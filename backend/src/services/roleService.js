const db = require('../config/db');

async function listRoles(tenantId) {
  return db('roles').where({ tenant_id: tenantId }).select('id', 'name').orderBy('name');
}

module.exports = { listRoles };
