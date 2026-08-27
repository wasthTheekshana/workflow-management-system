require('dotenv').config();

const base = {
  client: 'pg',
  migrations: { directory: './migrations', tableName: 'knex_migrations' },
};

function connection(databaseNameEnvVar) {
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env[databaseNameEnvVar],
    ssl: process.env.DB_SSL === 'true',
  };
}

module.exports = {
  development: { ...base, connection: connection('DB_NAME') },
  test: { ...base, connection: connection('DB_NAME_TEST') },
  production: { ...base, connection: connection('DB_NAME') },
};
