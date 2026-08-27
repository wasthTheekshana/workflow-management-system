const knex = require('knex');
const { validateEnv } = require('./env');

const config = validateEnv();

const db = knex({
  client: 'pg',
  connection: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
  },
});

module.exports = db;
