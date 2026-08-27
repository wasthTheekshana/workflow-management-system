# Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the backend skeleton for the Configurable Document Workflow Engine — repo, Docker Compose (API + PostgreSQL), the full Phase 1 schema (migrations 001–010), fail-fast env validation, JWT auth (sign/verify + middleware), baseline security middleware, and a minimal `/auth/login` + dev seed script — so every later phase has something real to build on and test against.

**Architecture:** Single Express app (`src/app.js`) with layered middleware (helmet → cors → rate limit → json → routes → 404 → central error handler). Business/auth logic lives in `src/services/`, never in route handlers. PostgreSQL schema managed entirely through Knex migrations (no raw SQL outside migration files). Config/env loading is centralized in `src/config/env.js` and fails fast on boot.

**Tech Stack:** Node.js 20, Express 4, PostgreSQL 16 (Knex 3 + `pg`), `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `dotenv`; Jest + Supertest for tests; Docker Compose for local Postgres.

**Spec:** `docs/superpowers/specs/2026-08-27-workflow-engine-design.md`

## Global Constraints

- Never hardcode secrets; `JWT_SECRET`/DB credentials come only from environment variables. (Spec §6)
- App must refuse to boot if `JWT_SECRET` is missing or under 32 characters. (Spec §6)
- `.env` is git-ignored; only `.env.example` (placeholders) is committed. (Spec §6)
- JWT verification pins `algorithms: ['HS256']` explicitly — never accept an unpinned algorithm. (Spec §6)
- All database access goes through the Knex query builder — no string-concatenated or template-literal SQL. (Spec §6)
- Every table except `tenants` carries a `tenant_id` column, indexed. (Spec §4, §6.3)
- `helmet()`, CORS origin-allowlist (never `*`), and a baseline rate limiter apply to the whole app. (Spec §6)
- Central error handler returns `{ error: string }` only — no stack traces or DB error text ever reach the client. (Spec §6, §7)
- Indexes match real query patterns: FK columns, plus `workflow_instances(tenant_id, status)`, `workflow_stages(workflow_template_id, stage_order)`, `stage_actions(workflow_instance_id)`, `notifications(status)`. (Spec §6.3)

---

## Task 1: Project scaffolding, dependencies, and git init

**Files:**
- Create: `backend/package.json`
- Create: `backend/.gitignore`
- Create: `backend/.env.example`
- Create: `.gitignore` (repo root, minimal — defers to `backend/.gitignore`)

**Interfaces:**
- Produces: an installable `backend/` Node project with all dependencies later tasks import by name (`express`, `knex`, `pg`, `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `dotenv`; dev: `jest`, `supertest`, `cross-env`).

- [ ] **Step 1: Initialize git repo at the project root**

Run:
```bash
cd "d:\Project\Workflow Managment System"
git init
git branch -M main
```
Expected: `Initialized empty Git repository...` and branch renamed to `main`.

- [ ] **Step 2: Create root `.gitignore`**

```gitignore
node_modules/
.env
*.log
```

- [ ] **Step 3: Create `backend/package.json`**

```json
{
  "name": "workflow-engine-backend",
  "version": "0.1.0",
  "private": true,
  "description": "Configurable document workflow engine — backend API",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "migrate": "knex migrate:latest",
    "migrate:rollback": "knex migrate:rollback",
    "seed": "node scripts/seed.js",
    "dev": "node src/server.js",
    "pretest": "cross-env NODE_ENV=test knex migrate:latest",
    "test": "cross-env NODE_ENV=test jest --runInBand"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.2.0",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "knex": "^3.1.0",
    "pg": "^8.11.5"
  },
  "devDependencies": {
    "cross-env": "^7.0.3",
    "jest": "^29.7.0",
    "supertest": "^6.3.4"
  }
}
```

- [ ] **Step 4: Create `backend/.gitignore`**

```gitignore
node_modules/
.env
npm-debug.log
```

- [ ] **Step 5: Create `backend/.env.example`**

```dotenv
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_USER=workflow
DB_PASSWORD=workflow_dev_password
DB_NAME=workflow_engine
DB_NAME_TEST=workflow_engine_test
DB_SSL=false

JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
JWT_EXPIRES_IN=1h

CORS_ORIGINS=http://localhost:5173
```

- [ ] **Step 6: Copy to a real local `.env` and install dependencies**

Run:
```bash
cd "d:\Project\Workflow Managment System\backend"
cp .env.example .env
npm install
```
Expected: `node_modules/` created, no install errors. (The placeholder `.env` values are fine for now — Docker Compose in Task 2 will match them.)

- [ ] **Step 7: Commit**

```bash
git add .gitignore backend/package.json backend/.gitignore backend/.env.example
git commit -m "chore: scaffold backend project and dependencies"
```
(`backend/.env` and `backend/node_modules/` are git-ignored and will not be staged — confirm with `git status` before committing.)

---

## Task 2: Docker Compose skeleton and Knex CLI config

**Files:**
- Create: `backend/docker-compose.yml`
- Create: `backend/Dockerfile`
- Create: `backend/docker/init-test-db.sql`
- Create: `backend/knexfile.js`

**Interfaces:**
- Produces: a running PostgreSQL instance on `localhost:5432` with both `workflow_engine` and `workflow_engine_test` databases, and a `knexfile.js` with `development`/`test`/`production` environments that Tasks 3+ and the `npm run migrate` / `pretest` scripts read.

- [ ] **Step 1: Create `backend/docker/init-test-db.sql`**

This runs once, on first container creation, to create the second database used by the test suite (Postgres's `POSTGRES_DB` env var only creates one database).

```sql
SELECT 'CREATE DATABASE workflow_engine_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'workflow_engine_test')
\gexec
```

- [ ] **Step 2: Create `backend/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER:-workflow}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-workflow_dev_password}
      POSTGRES_DB: ${DB_NAME:-workflow_engine}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-workflow}"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DB_HOST: postgres
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

- [ ] **Step 3: Create `backend/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

- [ ] **Step 4: Create `backend/knexfile.js`**

```js
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
```

Production TLS is controlled the same way as every other environment: set `DB_SSL=true` in the production `.env`. This keeps certificate verification on (`rejectUnauthorized` defaults to `true` when `ssl: true`) — never disable it to work around a self-signed cert; add the CA to the trust store instead.

- [ ] **Step 5: Start Postgres and verify both databases exist**

Run:
```bash
cd "d:\Project\Workflow Managment System\backend"
docker compose up -d postgres
docker compose exec postgres psql -U workflow -d workflow_engine -c "\l"
```
Expected: the database listing includes both `workflow_engine` and `workflow_engine_test`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml Dockerfile docker/init-test-db.sql knexfile.js
git commit -m "chore: add Docker Compose skeleton and Knex CLI config"
```

---

## Task 3: Full Phase 1 schema — migrations 001–010

**Files:**
- Create: `backend/migrations/001_create_tenants.js`
- Create: `backend/migrations/002_create_users.js`
- Create: `backend/migrations/003_create_roles.js`
- Create: `backend/migrations/004_create_user_roles.js`
- Create: `backend/migrations/005_create_template_files.js`
- Create: `backend/migrations/006_create_workflow_templates.js`
- Create: `backend/migrations/007_create_document_types.js`
- Create: `backend/migrations/008_create_workflow_instances.js`
- Create: `backend/migrations/009_create_instance_versions_and_stage_actions.js`
- Create: `backend/migrations/010_create_notifications.js`

**Interfaces:**
- Consumes: nothing (first schema-bearing task).
- Produces: the tables and columns every later phase's services and tests query directly by name — `tenants(id, name)`, `users(id, tenant_id, email, password_hash, full_name, is_admin)`, `roles(id, tenant_id, name)`, `user_roles(id, tenant_id, user_id, role_id)`, `template_files(id, tenant_id, name)`, `template_file_versions(id, tenant_id, template_file_id, version_number, file_path, uploaded_by)`, `workflow_templates(id, tenant_id, name)`, `workflow_stages(id, tenant_id, workflow_template_id, stage_order, name, assignee_type, assignee_user_id, assignee_role_id, allowed_actions)`, `document_types(id, tenant_id, name, template_file_id, workflow_template_id, allowed_extensions, max_upload_size_bytes)`, `workflow_instances(id, tenant_id, document_type_id, template_file_version_id, current_stage_order, status, claimed_by, created_by)`, `instance_versions(id, tenant_id, workflow_instance_id, version_number, file_path, uploaded_by)`, `stage_actions(id, tenant_id, workflow_instance_id, action_type, from_stage_order, to_stage_order, actor_id, comment)`, `notifications(id, tenant_id, workflow_instance_id, recipient_email, subject, body, status, attempts, last_error)`.

- [ ] **Step 1: `001_create_tenants.js`**

```js
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await knex.schema.createTable('tenants', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable();
    table.timestamps(true, true);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('tenants');
};
```

- [ ] **Step 2: `002_create_users.js`**

```js
exports.up = function up(knex) {
  return knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();
    table.string('full_name');
    table.boolean('is_admin').notNullable().defaultTo(false);
    table.timestamps(true, true);

    table.index('tenant_id');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('users');
};
```

- [ ] **Step 3: `003_create_roles.js`**

```js
exports.up = function up(knex) {
  return knex.schema.createTable('roles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.timestamps(true, true);

    table.unique(['tenant_id', 'name']);
    table.index('tenant_id');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('roles');
};
```

- [ ] **Step 4: `004_create_user_roles.js`**

```js
exports.up = function up(knex) {
  return knex.schema.createTable('user_roles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id', 'role_id']);
    table.index('tenant_id');
    table.index('user_id');
    table.index('role_id');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('user_roles');
};
```

- [ ] **Step 5: `005_create_template_files.js`**

```js
exports.up = async function up(knex) {
  await knex.schema.createTable('template_files', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.timestamps(true, true);

    table.index('tenant_id');
  });

  await knex.schema.createTable('template_file_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('template_file_id').notNullable().references('id').inTable('template_files').onDelete('CASCADE');
    table.integer('version_number').notNullable();
    table.string('file_path').notNullable();
    table.uuid('uploaded_by').references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['template_file_id', 'version_number']);
    table.index('tenant_id');
    table.index('template_file_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('template_file_versions');
  await knex.schema.dropTableIfExists('template_files');
};
```

- [ ] **Step 6: `006_create_workflow_templates.js`**

```js
exports.up = async function up(knex) {
  await knex.schema.createTable('workflow_templates', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.timestamps(true, true);

    table.index('tenant_id');
  });

  await knex.schema.createTable('workflow_stages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table
      .uuid('workflow_template_id')
      .notNullable()
      .references('id')
      .inTable('workflow_templates')
      .onDelete('CASCADE');
    table.integer('stage_order').notNullable();
    table.string('name').notNullable();
    table.enu('assignee_type', ['user', 'role'], { useNative: true, enumName: 'assignee_type' }).notNullable();
    table.uuid('assignee_user_id').references('id').inTable('users');
    table.uuid('assignee_role_id').references('id').inTable('roles');
    table.jsonb('allowed_actions').notNullable().defaultTo(JSON.stringify(['forward', 'send_back', 'reject']));
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['workflow_template_id', 'stage_order']);
    table.index('tenant_id');
    table.index(['workflow_template_id', 'stage_order']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('workflow_stages');
  await knex.raw('DROP TYPE IF EXISTS assignee_type');
  await knex.schema.dropTableIfExists('workflow_templates');
};
```

- [ ] **Step 7: `007_create_document_types.js`**

```js
exports.up = function up(knex) {
  return knex.schema.createTable('document_types', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name').notNullable();
    table.uuid('template_file_id').notNullable().references('id').inTable('template_files');
    table.uuid('workflow_template_id').notNullable().references('id').inTable('workflow_templates');
    table.jsonb('allowed_extensions').notNullable().defaultTo(JSON.stringify(['docx']));
    table.integer('max_upload_size_bytes').notNullable().defaultTo(10485760);
    table.timestamps(true, true);

    table.index('tenant_id');
    table.index('template_file_id');
    table.index('workflow_template_id');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('document_types');
};
```

- [ ] **Step 8: `008_create_workflow_instances.js`**

```js
exports.up = function up(knex) {
  return knex.schema.createTable('workflow_instances', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('document_type_id').notNullable().references('id').inTable('document_types');
    table.uuid('template_file_version_id').notNullable().references('id').inTable('template_file_versions');
    table.integer('current_stage_order').notNullable().defaultTo(1);
    table.string('status').notNullable().defaultTo('in_progress');
    table.uuid('claimed_by').references('id').inTable('users');
    table.uuid('created_by').notNullable().references('id').inTable('users');
    table.timestamps(true, true);

    table.index('tenant_id');
    table.index('document_type_id');
    table.index(['tenant_id', 'status']);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('workflow_instances');
};
```

- [ ] **Step 9: `009_create_instance_versions_and_stage_actions.js`**

```js
exports.up = async function up(knex) {
  await knex.schema.createTable('instance_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table
      .uuid('workflow_instance_id')
      .notNullable()
      .references('id')
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.integer('version_number').notNullable();
    table.string('file_path').notNullable();
    table.uuid('uploaded_by').notNullable().references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['workflow_instance_id', 'version_number']);
    table.index('tenant_id');
    table.index('workflow_instance_id');
  });

  await knex.schema.createTable('stage_actions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table
      .uuid('workflow_instance_id')
      .notNullable()
      .references('id')
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.string('action_type').notNullable();
    table.integer('from_stage_order');
    table.integer('to_stage_order');
    table.uuid('actor_id').notNullable().references('id').inTable('users');
    table.text('comment');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('tenant_id');
    table.index('workflow_instance_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('stage_actions');
  await knex.schema.dropTableIfExists('instance_versions');
};
```

- [ ] **Step 10: `010_create_notifications.js`**

```js
exports.up = function up(knex) {
  return knex.schema.createTable('notifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table
      .uuid('workflow_instance_id')
      .references('id')
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.string('recipient_email').notNullable();
    table.string('subject').notNullable();
    table.text('body').notNullable();
    table.string('status').notNullable().defaultTo('pending');
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('last_error');
    table.timestamps(true, true);

    table.index('tenant_id');
    table.index('status');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('notifications');
};
```

- [ ] **Step 11: Run migrations against both databases and verify**

Run:
```bash
cd "d:\Project\Workflow Managment System\backend"
npx knex migrate:latest --env development
npx knex migrate:latest --env test
npx knex migrate:list --env development
```
Expected: all 10 migrations report as run, `migrate:list` shows no pending migrations, and:
```bash
docker compose exec postgres psql -U workflow -d workflow_engine -c "\dt"
```
lists all 13 tables (`tenants`, `users`, `roles`, `user_roles`, `template_files`, `template_file_versions`, `workflow_templates`, `workflow_stages`, `document_types`, `workflow_instances`, `instance_versions`, `stage_actions`, `notifications`) plus `knex_migrations`/`knex_migrations_lock`.

- [ ] **Step 12: Commit**

```bash
git add migrations/
git commit -m "feat: add Phase 1 schema migrations 001-010"
```

---

## Task 4: Fail-fast environment validation

**Files:**
- Create: `backend/src/config/env.js`
- Test: `backend/tests/env.test.js`

**Interfaces:**
- Consumes: `process.env` (or an injected env object for testing).
- Produces: `validateEnv(env？) -> { port, nodeEnv, jwtSecret, jwtExpiresIn, corsOrigins: string[], db: { host, port, user, password, database, ssl } }`, thrown `Error` on invalid config. Every later task that needs config calls `require('../config/env').validateEnv()`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/env.test.js
const { validateEnv } = require('../src/config/env');

describe('validateEnv', () => {
  const validBase = {
    JWT_SECRET: 'a'.repeat(32),
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'workflow',
    DB_PASSWORD: 'secret',
    DB_NAME: 'workflow_engine',
  };

  it('throws when JWT_SECRET is missing', () => {
    const env = { ...validBase, JWT_SECRET: '' };
    expect(() => validateEnv(env)).toThrow('JWT_SECRET');
  });

  it('throws when JWT_SECRET is shorter than 32 characters', () => {
    const env = { ...validBase, JWT_SECRET: 'too-short' };
    expect(() => validateEnv(env)).toThrow('JWT_SECRET');
  });

  it('throws when a required DB variable is missing', () => {
    const env = { ...validBase, DB_HOST: '' };
    expect(() => validateEnv(env)).toThrow('DB_HOST');
  });

  it('returns a fully-populated config object for valid input', () => {
    const config = validateEnv(validBase);
    expect(config.jwtSecret).toBe(validBase.JWT_SECRET);
    expect(config.db).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'workflow',
      password: 'secret',
      database: 'workflow_engine',
      ssl: false,
    });
  });

  it('defaults port to 3000 and jwtExpiresIn to 1h when unset', () => {
    const config = validateEnv(validBase);
    expect(config.port).toBe(3000);
    expect(config.jwtExpiresIn).toBe('1h');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "d:\Project\Workflow Managment System\backend" && npx jest tests/env.test.js`
Expected: FAIL — `Cannot find module '../src/config/env'`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/config/env.js
require('dotenv').config();

function validateEnv(env = process.env) {
  const errors = [];

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be set and at least 32 characters long');
  }
  if (!env.DB_HOST) errors.push('DB_HOST is required');
  if (!env.DB_PORT) errors.push('DB_PORT is required');
  if (!env.DB_USER) errors.push('DB_USER is required');
  if (!env.DB_PASSWORD) errors.push('DB_PASSWORD is required');
  if (!env.DB_NAME) errors.push('DB_NAME is required');

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.join('\n')}`);
  }

  const isTest = env.NODE_ENV === 'test';
  const databaseName = isTest ? env.DB_NAME_TEST || `${env.DB_NAME}_test` : env.DB_NAME;

  return {
    port: parseInt(env.PORT || '3000', 10),
    nodeEnv: env.NODE_ENV || 'development',
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '1h',
    corsOrigins: (env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    db: {
      host: env.DB_HOST,
      port: parseInt(env.DB_PORT, 10),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: databaseName,
      ssl: env.DB_SSL === 'true',
    },
  };
}

module.exports = { validateEnv };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/env.test.js`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.js tests/env.test.js
git commit -m "feat: add fail-fast environment validation"
```

---

## Task 5: Knex database connection

**Files:**
- Create: `backend/src/config/db.js`

**Interfaces:**
- Consumes: `validateEnv()` from Task 4 (`src/config/env.js`).
- Produces: a singleton Knex instance (`module.exports = db`) that Tasks 6, 8, 9 and all later phases use for every query — `require('../config/db')`.

- [ ] **Step 1: Create `backend/src/config/db.js`**

```js
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
```

- [ ] **Step 2: Verify it connects**

Run (from `backend/`, with `docker compose up -d postgres` already running from Task 2):
```bash
node -e "const db = require('./src/config/db'); db.raw('SELECT 1+1 AS result').then(r => { console.log(r.rows); return db.destroy(); })"
```
Expected: prints `[ { result: 2 } ]` and exits cleanly with no hanging connection.

- [ ] **Step 3: Commit**

```bash
git add src/config/db.js
git commit -m "feat: add Knex database connection module"
```

---

## Task 6: JWT signing and verification utility

**Files:**
- Create: `backend/src/utils/jwt.js`
- Test: `backend/tests/jwt.test.js`

**Interfaces:**
- Consumes: `validateEnv()` from Task 4.
- Produces: `signToken(payload: object) -> string`, `verifyToken(token: string) -> object` (throws on invalid/expired/wrong-secret tokens). Task 7's `authenticate` middleware and Task 9's `authService.login` both call these by name.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/jwt.test.js
const jwt = require('jsonwebtoken');
const { signToken, verifyToken } = require('../src/utils/jwt');

describe('jwt utils', () => {
  it('round-trips a payload through sign and verify', () => {
    const token = signToken({ sub: 'user-1', tenant_id: 'tenant-1', is_admin: false });
    const payload = verifyToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.tenant_id).toBe('tenant-1');
    expect(payload.is_admin).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const tampered = jwt.sign({ sub: 'user-1' }, 'a-completely-different-secret-value-here', {
      algorithm: 'HS256',
    });
    expect(() => verifyToken(tampered)).toThrow();
  });

  it('rejects a malformed token', () => {
    expect(() => verifyToken('not-a-real-token')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/jwt.test.js`
Expected: FAIL — `Cannot find module '../src/utils/jwt'`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/utils/jwt.js
const jwt = require('jsonwebtoken');
const { validateEnv } = require('../config/env');

const config = validateEnv();

function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

module.exports = { signToken, verifyToken };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/jwt.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/jwt.js tests/jwt.test.js
git commit -m "feat: add JWT sign/verify utility pinned to HS256"
```

---

## Task 7: AppError, central error handler, and auth middleware

**Files:**
- Create: `backend/src/utils/AppError.js`
- Create: `backend/src/middleware/errorHandler.js`
- Create: `backend/src/middleware/auth.js`
- Test: `backend/tests/authMiddleware.test.js`

**Interfaces:**
- Consumes: `verifyToken` from Task 6 (`src/utils/jwt.js`).
- Produces: `class AppError extends Error` (constructor `(statusCode: number, message: string)`, sets `isAppError = true`), `errorHandler(err, req, res, next)` (Express error middleware), `authenticate(req, res, next)` (Express middleware; on success sets `req.user = { userId, tenantId, isAdmin }`). Task 8's `app.js` wires `errorHandler` in; Task 9's `authService` throws `AppError`; Phase 1+ route handlers use `authenticate`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/authMiddleware.test.js
const express = require('express');
const request = require('supertest');
const { authenticate } = require('../src/middleware/auth');
const errorHandler = require('../src/middleware/errorHandler');
const { signToken } = require('../src/utils/jwt');

function buildTestApp() {
  const app = express();
  app.get('/protected', authenticate, (req, res) => {
    res.status(200).json({ user: req.user });
  });
  app.use(errorHandler);
  return app;
}

describe('authenticate middleware', () => {
  const app = buildTestApp();

  it('rejects requests with no authorization header', async () => {
    const response = await request(app).get('/protected');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Missing or invalid authorization header' });
  });

  it('rejects a malformed authorization header', async () => {
    const response = await request(app).get('/protected').set('Authorization', 'Token abc123');
    expect(response.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const response = await request(app).get('/protected').set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid or expired token' });
  });

  it('accepts a valid bearer token and attaches req.user', async () => {
    const token = signToken({ sub: 'user-1', tenant_id: 'tenant-1', is_admin: true });
    const response = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ userId: 'user-1', tenantId: 'tenant-1', isAdmin: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/authMiddleware.test.js`
Expected: FAIL — `Cannot find module '../src/middleware/auth'`.

- [ ] **Step 3: Write `backend/src/utils/AppError.js`**

```js
class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isAppError = true;
  }
}

module.exports = AppError;
```

- [ ] **Step 4: Write `backend/src/middleware/errorHandler.js`**

```js
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.isAppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
```

- [ ] **Step 5: Write `backend/src/middleware/auth.js`**

```js
const { verifyToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'Missing or invalid authorization header'));
  }

  try {
    const payload = verifyToken(token);
    req.user = {
      userId: payload.sub,
      tenantId: payload.tenant_id,
      isAdmin: !!payload.is_admin,
    };
    return next();
  } catch (err) {
    return next(new AppError(401, 'Invalid or expired token'));
  }
}

module.exports = { authenticate };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/authMiddleware.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/utils/AppError.js src/middleware/errorHandler.js src/middleware/auth.js tests/authMiddleware.test.js
git commit -m "feat: add AppError, central error handler, and JWT auth middleware"
```

---

## Task 8: Express app — helmet, CORS, rate limiting, health check

**Files:**
- Create: `backend/src/routes/health.js`
- Create: `backend/src/app.js`
- Test: `backend/tests/health.test.js`
- Test: `backend/tests/securityBaseline.test.js`

**Interfaces:**
- Consumes: `validateEnv()` (Task 4), `errorHandler` (Task 7).
- Produces: `module.exports = app` (an Express app, not yet listening) — Task 9 mounts `/auth` onto it, Task 10's `server.js` calls `app.listen(...)`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/health.test.js
const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  it('returns 200 and status ok', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

```js
// backend/tests/securityBaseline.test.js
const request = require('supertest');
const app = require('../src/app');

describe('security baseline', () => {
  it('sets standard security headers via helmet', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('returns a generic 404 body for unknown routes', async () => {
    const response = await request(app).get('/no-such-route');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/health.test.js tests/securityBaseline.test.js`
Expected: FAIL — `Cannot find module '../src/app'`.

- [ ] **Step 3: Write `backend/src/routes/health.js`**

```js
const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

module.exports = router;
```

- [ ] **Step 4: Write `backend/src/app.js`**

```js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { validateEnv } = require('./config/env');
const healthRouter = require('./routes/health');
const errorHandler = require('./middleware/errorHandler');

const config = validateEnv();

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
  }),
);
app.use(express.json());

const baselineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(baselineLimiter);

app.use('/health', healthRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/health.test.js tests/securityBaseline.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/routes/health.js src/app.js tests/health.test.js tests/securityBaseline.test.js
git commit -m "feat: add Express app with helmet, CORS, rate limiting, and health check"
```

---

## Task 9: `/auth/login` endpoint

**Files:**
- Create: `backend/src/services/authService.js`
- Create: `backend/src/routes/auth.js`
- Modify: `backend/src/app.js` (mount the auth router)
- Test: `backend/tests/auth.test.js`

**Interfaces:**
- Consumes: `db` (Task 5), `signToken` (Task 6), `AppError` (Task 7).
- Produces: `login(email: string, password: string) -> Promise<{ token: string }>` (throws `AppError(401, ...)` on bad credentials); mounts `POST /auth/login` on the app. Task 10's seed script creates the user rows this endpoint authenticates against.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/auth.test.js
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/config/db');

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('POST /auth/login', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Test Tenant' }).onConflict('id').ignore();
    const passwordHash = await bcrypt.hash('correct-password', 10);
    await db('users')
      .insert({
        id: USER_ID,
        tenant_id: TENANT_ID,
        email: 'login-test@example.com',
        password_hash: passwordHash,
        is_admin: true,
      })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('users').where({ id: USER_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('returns a JWT for valid credentials', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'login-test@example.com', password: 'correct-password' });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');
  });

  it('returns 401 with a generic message for a wrong password', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'login-test@example.com', password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 401 with the same generic message for an unknown email', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid email or password' });
  });

  it('returns 400 when email or password is missing', async () => {
    const response = await request(app).post('/auth/login').send({ password: 'x' });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/auth.test.js`
Expected: FAIL — `Cannot find module '../src/services/authService'` (or 404, since `/auth` isn't mounted yet).

- [ ] **Step 3: Write `backend/src/services/authService.js`**

```js
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { signToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

async function login(email, password) {
  const user = await db('users').where({ email }).first();

  if (!user) {
    throw new AppError(401, INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new AppError(401, INVALID_CREDENTIALS_MESSAGE);
  }

  const token = signToken({
    sub: user.id,
    tenant_id: user.tenant_id,
    is_admin: user.is_admin,
  });

  return { token };
}

module.exports = { login };
```

- [ ] **Step 4: Write `backend/src/routes/auth.js`**

```js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { login } = require('../services/authService');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const result = await login(email, password);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Mount the router in `backend/src/app.js`**

Add near the top, with the other route imports:
```js
const authRouter = require('./routes/auth');
```
Add next to `app.use('/health', healthRouter);`:
```js
app.use('/auth', authRouter);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/auth.test.js`
Expected: PASS, all 4 tests green. (Requires `docker compose up -d postgres` running and the test database migrated — `npm test`'s `pretest` script handles the migration automatically.)

- [ ] **Step 7: Commit**

```bash
git add src/services/authService.js src/routes/auth.js src/app.js tests/auth.test.js
git commit -m "feat: add POST /auth/login endpoint"
```

---

## Task 10: Dev seed script, server entrypoint, and full exit-criteria verification

**Files:**
- Create: `backend/scripts/seed.js`
- Create: `backend/src/server.js`

**Interfaces:**
- Consumes: `db` (Task 5), `app` (Task 8/9).
- Produces: a runnable `npm run seed` that creates a dev tenant + admin user; a runnable `npm run dev` that boots the HTTP server. This is the phase's final integration task — no later task depends on new exports from it.

- [ ] **Step 1: Write `backend/scripts/seed.js`**

```js
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
```

- [ ] **Step 2: Write `backend/src/server.js`**

```js
const app = require('./app');
const { validateEnv } = require('./config/env');

const config = validateEnv();

app.listen(config.port, () => {
  console.log(`Workflow engine API listening on port ${config.port}`);
});
```

- [ ] **Step 3: Run the full exit-criteria check from a clean state**

Run, from `backend/`:
```bash
docker compose down -v
docker compose up -d postgres
npm install
npm run migrate
npm run seed
npm run dev
```
Expected: migrations apply cleanly, seed prints the dev admin credentials, and the server logs `Workflow engine API listening on port 3000`.

In a second terminal:
```bash
curl -i http://localhost:3000/health
curl -i -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@dev.local\",\"password\":\"ChangeMe123!\"}"
```
Expected: `/health` returns `200 {"status":"ok"}`; `/auth/login` returns `200` with a `token` field containing a JWT.

Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 4: Run the full automated test suite**

Run: `npm test`
Expected: `pretest` re-runs migrations against the test database, then all Jest suites from Tasks 4, 6, 7, 8, and 9 pass (health, env, jwt, authMiddleware, securityBaseline, auth — 4+3+3+4+3+4 = 21 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.js src/server.js
git commit -m "feat: add dev seed script and server entrypoint"
```

---

## Phase 0 Exit Criteria (verify all before moving to Phase 1)

- [ ] Fresh clone + `npm install` + `npm run migrate` + `npm run dev` boots cleanly.
- [ ] `GET /health` returns `200 { "status": "ok" }`.
- [ ] `POST /auth/login` with seeded credentials returns a valid JWT; wrong/unknown credentials return a generic `401 { "error": "Invalid email or password" }` with no detail leaked.
- [ ] All 10 migrations run cleanly on a fresh database (`docker compose down -v` then re-migrate).
- [ ] `npm test` passes in full against the dockerized test database.
- [ ] `.env` is git-ignored and not present in `git log`/`git status`; only `.env.example` is committed.
- [ ] `helmet`, CORS allowlist, and baseline rate limiting are active on every route (verified by `securityBaseline.test.js`).
