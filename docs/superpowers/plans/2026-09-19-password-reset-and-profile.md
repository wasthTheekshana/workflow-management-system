# Self-Service Password Reset & User Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any user reset a forgotten password via a one-time emailed link, and let any logged-in user update their own display name and/or password from a profile page.

**Architecture:** A new `password_reset_tokens` table stores only a SHA-256 hash of each single-use, 1-hour-expiry token. `authService.js` gains `requestPasswordReset`/`resetPassword`; `userService.js` gains `updateOwnProfile`. Two new public routes on the existing `/auth` router and one new authenticated route on the existing `/users` router. The reset email is sent directly through the existing `transporter` (bypassing the queued, in-app-visible `notifications` table, since a live reset link must never sit in the notification bell). Frontend adds three pages (`ForgotPasswordPage`, `ResetPasswordPage`, `ProfilePage`) and extends `api/auth.ts`.

**Tech Stack:** Node.js/Express/Knex/PostgreSQL backend, React/TypeScript/Vite frontend, Jest+Supertest backend tests, `tsc -b` for frontend verification (no frontend test framework in this repo).

**Spec:** `docs/superpowers/specs/2026-09-19-password-reset-and-profile-design.md`

## Global Constraints

- The raw reset token is never persisted — only `sha256(rawToken)` is stored (spec §2).
- A token is single-use (`used_at` set on consumption) and expires after 1 hour (spec §2, §3.1).
- Requesting a new reset token invalidates any prior unused token for that user (spec §3.1).
- `POST /auth/forgot-password` always responds `200` with the same generic message, whether or not the email matched a user — no timing or body difference (spec §3.3).
- Password-reset emails are sent directly via `config/mailer.js`'s `transporter`, **not** through `notificationService`'s queued `notifications` table — that table backs the in-app notification bell, and a live reset link must never appear there (spec §3.1).
- Profile password change has no current-password check (spec §5, explicitly declined).
- Every backend change must keep the full existing test suite passing.

---

## Task 1: Migration — `password_reset_tokens` table

**Files:**
- Create: `backend/migrations/024_create_password_reset_tokens.js`
- Test: Create `backend/tests/passwordResetSchema.test.js`

**Interfaces:**
- Produces: table `password_reset_tokens` with columns `id` (uuid pk), `tenant_id` (uuid, not null, FK → `tenants.id`), `user_id` (uuid, not null, composite FK `[tenant_id, user_id]` → `users[tenant_id, id]`, `onDelete('CASCADE')`), `token_hash` (text, not null, indexed), `expires_at` (timestamp, not null), `used_at` (timestamp, nullable), `created_at` (timestamp, default `now()`). Index on `[tenant_id, user_id]`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/passwordResetSchema.test.js
const db = require('../src/config/db');

describe('password_reset_tokens schema', () => {
  afterAll(async () => {
    await db.destroy();
  });

  it('creates the password_reset_tokens table with the expected columns', async () => {
    expect(await db.schema.hasTable('password_reset_tokens')).toBe(true);

    const columns = await db('password_reset_tokens').columnInfo();
    expect(columns.tenant_id.nullable).toBe(false);
    expect(columns.user_id.nullable).toBe(false);
    expect(columns.token_hash.nullable).toBe(false);
    expect(columns.expires_at.nullable).toBe(false);
    expect(columns.used_at.nullable).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/passwordResetSchema.test.js`
Expected: FAIL — the table doesn't exist yet.

- [ ] **Step 3: Write the migration**

```js
// backend/migrations/024_create_password_reset_tokens.js
exports.up = function up(knex) {
  return knex.schema.createTable('password_reset_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('user_id').notNullable();
    table.text('token_hash').notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('token_hash');
    table.index(['tenant_id', 'user_id']);

    table
      .foreign(['tenant_id', 'user_id'])
      .references(['tenant_id', 'id'])
      .inTable('users')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('password_reset_tokens');
};
```

- [ ] **Step 4: Run migrations and the test again to verify it passes**

Run: `cd backend && npx cross-env NODE_ENV=test npx knex migrate:latest && npx cross-env NODE_ENV=test npx jest tests/passwordResetSchema.test.js`
Expected: PASS.

- [ ] **Step 5: Apply the migration to the dev database too**

Run: `cd backend && npx knex migrate:latest`

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/024_create_password_reset_tokens.js backend/tests/passwordResetSchema.test.js
git commit -m "feat: add password_reset_tokens table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Backend — `authService` reset flow + `/auth/forgot-password` and `/auth/reset-password`

**Files:**
- Modify: `backend/src/services/authService.js`
- Modify: `backend/src/services/userService.js` (export `MIN_PASSWORD_LENGTH`)
- Modify: `backend/src/routes/auth.js`
- Modify: `backend/src/config/env.js` (add `frontendBaseUrl`)
- Modify: `backend/.env.example` (document `FRONTEND_BASE_URL`)
- Test: Create `backend/tests/passwordReset.test.js`

**Interfaces:**
- Consumes: `password_reset_tokens` table (Task 1); `transporter`/`MAIL_FROM` from `backend/src/config/mailer.js` (existing); `MIN_PASSWORD_LENGTH` exported from `userService.js`; `validateEnv()` from `backend/src/config/env.js`.
- Produces: `authService.requestPasswordReset(email, sendMail?)` → `Promise<void>` (never throws for "not found" — always resolves). `authService.resetPassword(rawToken, newPassword)` → `Promise<void>`, throws `AppError(400, ...)` for an invalid/expired/used token or a too-short password. Routes `POST /auth/forgot-password` and `POST /auth/reset-password` on the existing `authRouter` (mounted at `/auth` in `app.js`).

- [ ] **Step 1: Export `MIN_PASSWORD_LENGTH` from `userService.js`**

In `backend/src/services/userService.js`, change the final line:

```js
module.exports = { listUsers, createUser };
```

to:

```js
module.exports = { listUsers, createUser, MIN_PASSWORD_LENGTH };
```

(`MIN_PASSWORD_LENGTH` is already defined at the top of the file as `const MIN_PASSWORD_LENGTH = 8;` — no other change needed here.)

- [ ] **Step 2: Add `frontendBaseUrl` to env config**

In `backend/src/config/env.js`, inside the object `validateEnv` returns, add a new field alongside `corsOrigins`:

```js
    corsOrigins: (env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    frontendBaseUrl: env.FRONTEND_BASE_URL || 'http://localhost:5173',
```

In `backend/.env.example`, add this line right after the `CORS_ORIGINS=http://localhost:5173` line:

```
FRONTEND_BASE_URL=http://localhost:5173
```

This local dev instance actually runs its frontend on port 5174 (a pre-existing port conflict with another project on this machine — see `backend/.env`'s `CORS_ORIGINS`). Add `FRONTEND_BASE_URL=http://localhost:5174` to the real (gitignored) `backend/.env` as part of this step too, so reset links generated locally point at the right port — this does not go in `.env.example`, which documents the tool's own default.

- [ ] **Step 3: Write the failing tests**

```js
// backend/tests/passwordReset.test.js
const request = require('supertest');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const app = require('../src/app');
const db = require('../src/config/db');
const { requestPasswordReset } = require('../src/services/authService');

const TENANT_ID = 'a1000000-0000-0000-0000-000000000001';
const USER_ID = 'a1000000-0000-0000-0000-000000000002';
const OTHER_TENANT_ID = 'a1000000-0000-0000-0000-000000000003';
const OTHER_USER_ID = 'a1000000-0000-0000-0000-000000000004';

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

describe('password reset', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Password Reset Tenant' }).onConflict('id').ignore();
    await db('tenants').insert({ id: OTHER_TENANT_ID, name: 'Other Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({
        id: USER_ID,
        tenant_id: TENANT_ID,
        email: 'pwreset@example.com',
        password_hash: await bcrypt.hash('OldPassword1', 10),
      })
      .onConflict('id')
      .ignore();
    await db('users')
      .insert({
        id: OTHER_USER_ID,
        tenant_id: OTHER_TENANT_ID,
        email: 'other-tenant@example.com',
        password_hash: await bcrypt.hash('OldPassword1', 10),
      })
      .onConflict('id')
      .ignore();
  });

  afterEach(async () => {
    await db('password_reset_tokens').where({ tenant_id: TENANT_ID }).del();
    await db('password_reset_tokens').where({ tenant_id: OTHER_TENANT_ID }).del();
  });

  afterAll(async () => {
    await db('users').whereIn('id', [USER_ID, OTHER_USER_ID]).del();
    await db('tenants').whereIn('id', [TENANT_ID, OTHER_TENANT_ID]).del();
    await db.destroy();
  });

  it('POST /auth/forgot-password returns 200 with a generic message for a real email and creates a token', async () => {
    const response = await request(app).post('/auth/forgot-password').send({ email: 'pwreset@example.com' });
    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/if that email is registered/i);

    const rows = await db('password_reset_tokens').where({ tenant_id: TENANT_ID, user_id: USER_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].used_at).toBeNull();
  });

  it('POST /auth/forgot-password returns the identical 200 response for an unknown email, with no token created', async () => {
    const response = await request(app).post('/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/if that email is registered/i);

    const rows = await db('password_reset_tokens');
    expect(rows).toHaveLength(0);
  });

  it('requesting a second reset invalidates the first token', async () => {
    const sent = [];
    const fakeSendMail = async (mail) => {
      sent.push(mail);
      return {};
    };

    await requestPasswordReset('pwreset@example.com', fakeSendMail);
    const firstLink = sent[0].text.match(/token=([a-f0-9]+)/)[1];

    await requestPasswordReset('pwreset@example.com', fakeSendMail);

    const staleAttempt = await request(app)
      .post('/auth/reset-password')
      .send({ token: firstLink, newPassword: 'BrandNewPassword1' });
    expect(staleAttempt.status).toBe(400);

    const rows = await db('password_reset_tokens').where({ tenant_id: TENANT_ID, user_id: USER_ID });
    expect(rows).toHaveLength(1);
  });

  it('resets the password with a valid token, and the token cannot be reused', async () => {
    const sent = [];
    await requestPasswordReset('pwreset@example.com', async (mail) => {
      sent.push(mail);
      return {};
    });
    const rawToken = sent[0].text.match(/token=([a-f0-9]+)/)[1];

    const resetResponse = await request(app)
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'BrandNewPassword1' });
    expect(resetResponse.status).toBe(200);

    const oldLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'pwreset@example.com', password: 'OldPassword1' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'pwreset@example.com', password: 'BrandNewPassword1' });
    expect(newLogin.status).toBe(200);

    const reuseAttempt = await request(app)
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'AnotherPassword1' });
    expect(reuseAttempt.status).toBe(400);

    const tokenRow = await hashAndFindToken(rawToken);
    expect(tokenRow.used_at).not.toBeNull();
  });

  it('rejects an expired token', async () => {
    const rawToken = 'a'.repeat(64);
    await db('password_reset_tokens').insert({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() - 1000),
    });

    const response = await request(app)
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'BrandNewPassword1' });
    expect(response.status).toBe(400);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const rawToken = 'b'.repeat(64);
    await db('password_reset_tokens').insert({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + 3600000),
    });

    const response = await request(app)
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'short' });
    expect(response.status).toBe(400);
  });

  it('rejects an unknown token', async () => {
    const response = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'c'.repeat(64), newPassword: 'BrandNewPassword1' });
    expect(response.status).toBe(400);
  });

  async function hashAndFindToken(rawToken) {
    return db('password_reset_tokens').where({ token_hash: hashToken(rawToken) }).first();
  }
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/passwordReset.test.js`
Expected: FAIL — `requestPasswordReset` doesn't exist and the routes 404.

- [ ] **Step 5: Implement `requestPasswordReset` and `resetPassword` in `authService.js`**

Replace the full contents of `backend/src/services/authService.js`:

```js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const { signToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');
const { transporter, MAIL_FROM } = require('../config/mailer');
const { validateEnv } = require('../config/env');
const { MIN_PASSWORD_LENGTH } = require('./userService');

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

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

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function requestPasswordReset(email, sendMail = transporter.sendMail.bind(transporter)) {
  const user = await db('users').where({ email }).first();
  if (!user) {
    return;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db('password_reset_tokens').where({ tenant_id: user.tenant_id, user_id: user.id, used_at: null }).del();
  await db('password_reset_tokens').insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const { frontendBaseUrl } = validateEnv();
  const resetLink = `${frontendBaseUrl}/reset-password?token=${rawToken}`;

  try {
    await sendMail({
      from: MAIL_FROM,
      to: email,
      subject: 'Reset your password',
      text: `Use this link to reset your password (valid for 1 hour): ${resetLink}`,
    });
  } catch (err) {
    console.error('Failed to send password reset email:', err.message);
  }
}

async function resetPassword(rawToken, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(400, `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const tokenHash = hashToken(rawToken);
  const tokenRow = await db('password_reset_tokens')
    .where({ token_hash: tokenHash, used_at: null })
    .where('expires_at', '>', new Date())
    .first();

  if (!tokenRow) {
    throw new AppError(400, 'This reset link is invalid or has expired');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await db.transaction(async (trx) => {
    await trx('users').where({ tenant_id: tokenRow.tenant_id, id: tokenRow.user_id }).update({ password_hash: passwordHash });
    await trx('password_reset_tokens').where({ id: tokenRow.id }).update({ used_at: trx.fn.now() });
  });
}

module.exports = { login, requestPasswordReset, resetPassword };
```

- [ ] **Step 6: Add the routes to `backend/src/routes/auth.js`**

Replace the full contents:

```js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { login, requestPasswordReset, resetPassword } = require('../services/authService');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests, please try again later' },
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

router.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    await requestPasswordReset(email);
    return res.status(200).json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    return next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }
    await resetPassword(token, newPassword);
    return res.status(200).json({ message: 'Password has been reset.' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/passwordReset.test.js`
Expected: PASS — all 8 `it` blocks.

- [ ] **Step 8: Run the full suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — every existing suite plus the two new ones from Task 1 and this task.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/authService.js backend/src/services/userService.js backend/src/routes/auth.js backend/src/config/env.js backend/.env.example backend/tests/passwordReset.test.js
git commit -m "feat: add self-service forgot-password and reset-password flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Backend — `PATCH /users/me` profile update

**Files:**
- Modify: `backend/src/services/userService.js`
- Modify: `backend/src/routes/users.js`
- Test: Create `backend/tests/userProfile.test.js`

**Interfaces:**
- Consumes: `assertRequiredString` from `backend/src/utils/validation.js` (existing); `authenticate` middleware (existing, already applied via `router.use(authenticate)` in `routes/users.js`).
- Produces: `userService.updateOwnProfile(tenantId, userId, { fullName, newPassword })` → `Promise<{ id, email, full_name, is_admin }>`, throws `AppError(400, ...)` when neither field is given, when `fullName` is an empty string, or when `newPassword` is shorter than `MIN_PASSWORD_LENGTH`. Route `PATCH /users/me`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/userProfile.test.js
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/config/db');
const { signToken } = require('../src/utils/jwt');

const TENANT_ID = 'b1000000-0000-0000-0000-000000000001';
const USER_ID = 'b1000000-0000-0000-0000-000000000002';
const token = signToken({ sub: USER_ID, tenant_id: TENANT_ID, is_admin: false });

describe('PATCH /users/me', () => {
  beforeAll(async () => {
    await db('tenants').insert({ id: TENANT_ID, name: 'Profile Test Tenant' }).onConflict('id').ignore();
    await db('users')
      .insert({
        id: USER_ID,
        tenant_id: TENANT_ID,
        email: 'profile-test@example.com',
        password_hash: await bcrypt.hash('OriginalPassword1', 10),
        full_name: 'Original Name',
      })
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    await db('users').where({ id: USER_ID }).del();
    await db('tenants').where({ id: TENANT_ID }).del();
    await db.destroy();
  });

  it('returns 401 when unauthenticated', async () => {
    const response = await request(app).patch('/users/me').send({ fullName: 'New Name' });
    expect(response.status).toBe(401);
  });

  it('returns 400 when neither fullName nor newPassword is provided', async () => {
    const response = await request(app).patch('/users/me').set('Authorization', `Bearer ${token}`).send({});
    expect(response.status).toBe(400);
  });

  it('returns 400 for a new password shorter than 8 characters', async () => {
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'short' });
    expect(response.status).toBe(400);
  });

  it('updates fullName only', async () => {
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Updated Name' });
    expect(response.status).toBe(200);
    expect(response.body.full_name).toBe('Updated Name');

    const row = await db('users').where({ id: USER_ID }).first();
    expect(row.full_name).toBe('Updated Name');
  });

  it('updates newPassword only, and the new password logs in', async () => {
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'BrandNewPassword2' });
    expect(response.status).toBe(200);

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({ email: 'profile-test@example.com', password: 'BrandNewPassword2' });
    expect(loginResponse.status).toBe(200);
  });

  it('updates both fullName and newPassword together', async () => {
    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Both Fields Name', newPassword: 'AnotherPassword3' });
    expect(response.status).toBe(200);
    expect(response.body.full_name).toBe('Both Fields Name');

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({ email: 'profile-test@example.com', password: 'AnotherPassword3' });
    expect(loginResponse.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/userProfile.test.js`
Expected: FAIL — `PATCH /users/me` doesn't exist yet (404s where a 401/400/200 is expected).

- [ ] **Step 3: Implement `updateOwnProfile` in `userService.js`**

Add this function to `backend/src/services/userService.js`, after `createUser` and before `module.exports`:

```js
async function updateOwnProfile(tenantId, userId, { fullName, newPassword }) {
  if (fullName === undefined && newPassword === undefined) {
    throw new AppError(400, 'fullName or newPassword is required');
  }

  const updates = {};

  if (fullName !== undefined) {
    assertRequiredString(fullName, 'fullName');
    updates.full_name = fullName;
  }

  if (newPassword !== undefined) {
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(400, `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    updates.password_hash = await bcrypt.hash(newPassword, 10);
  }

  const [user] = await db('users')
    .where({ tenant_id: tenantId, id: userId })
    .update(updates)
    .returning(['id', 'email', 'full_name', 'is_admin']);

  return user;
}
```

Update the final export line to:

```js
module.exports = { listUsers, createUser, updateOwnProfile, MIN_PASSWORD_LENGTH };
```

- [ ] **Step 4: Add the route to `backend/src/routes/users.js`**

Replace the full contents:

```js
// backend/src/routes/users.js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { listVisibleUsers } = require('../services/visibilityService');
const { updateOwnProfile } = require('../services/userService');

const router = express.Router();

router.use(authenticate);

router.get('/visible', async (req, res, next) => {
  try {
    res.status(200).json(await listVisibleUsers(req.user.tenantId, req.user.userId, req.user.isAdmin));
  } catch (err) {
    next(err);
  }
});

router.patch('/me', async (req, res, next) => {
  try {
    const user = await updateOwnProfile(req.user.tenantId, req.user.userId, {
      fullName: req.body.fullName,
      newPassword: req.body.newPassword,
    });
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cd backend && npx cross-env NODE_ENV=test npx jest tests/userProfile.test.js`
Expected: PASS — all 6 `it` blocks.

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `cd backend && npm test`
Expected: PASS — every existing suite plus this new one.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/userService.js backend/src/routes/users.js backend/tests/userProfile.test.js
git commit -m "feat: let a user update their own display name and password

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — API layer

**Files:**
- Modify: `frontend/src/api/auth.ts`

**Interfaces:**
- Consumes: `apiFetch` from `frontend/src/api/client.ts` (existing).
- Produces: `requestPasswordReset(email: string): Promise<{ message: string }>`, `resetPassword(token: string, newPassword: string): Promise<{ message: string }>`, `updateProfile(input: { fullName?: string; newPassword?: string }): Promise<{ id: string; email: string; full_name: string | null; is_admin: boolean }>` — all exported from `api/auth.ts` for Task 5 to consume.

- [ ] **Step 1: Add the three functions to `frontend/src/api/auth.ts`**

Append to the end of the file (after the existing `decodeToken` function):

```ts
export function requestPasswordReset(email: string): Promise<{ message: string }> {
  return apiFetch('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  return apiFetch('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
}

export function updateProfile(input: { fullName?: string; newPassword?: string }): Promise<UserProfile> {
  return apiFetch('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no output (clean compile).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/auth.ts
git commit -m "feat: add frontend API functions for password reset and profile update

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — `ForgotPasswordPage`, `ResetPasswordPage`, `ProfilePage`, and routing

**Files:**
- Create: `frontend/src/pages/ForgotPasswordPage.tsx`
- Create: `frontend/src/pages/ResetPasswordPage.tsx`
- Create: `frontend/src/pages/ProfilePage.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `requestPasswordReset`, `resetPassword`, `updateProfile` (Task 4); `ApiError` from `frontend/src/api/client.ts` (existing).

- [ ] **Step 1: Create `frontend/src/pages/ForgotPasswordPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../api/auth';
import { ApiError } from '../api/client';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await requestPasswordReset(email);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request password reset');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Forgot password</h1>
        {message ? (
          <p className="rounded bg-green-50 p-2 text-sm text-green-700">{message}</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
            <label className="mb-6 block text-sm">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}
        <Link to="/login" className="mt-4 block text-center text-sm text-blue-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/pages/ResetPasswordPage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api/auth';
import { ApiError } from '../api/client';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setIsSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
          <p className="rounded bg-red-50 p-2 text-sm text-red-700">
            This reset link is missing its token. Request a new one.
          </p>
          <Link to="/forgot-password" className="mt-4 block text-center text-sm text-blue-700 hover:underline">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Reset password</h1>
        {error && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <label className="mb-3 block text-sm">
          New password
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="mb-6 block text-sm">
          Confirm new password
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Resetting...' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/pages/ProfilePage.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { updateProfile } from '../api/auth';
import { ApiError } from '../api/client';

export function ProfilePage() {
  const [fullName, setFullName] = useState('');
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSavingName, setIsSavingName] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  async function handleNameSubmit(event: FormEvent) {
    event.preventDefault();
    setNameError(null);
    setNameMessage(null);
    setIsSavingName(true);
    try {
      await updateProfile({ fullName });
      setNameMessage('Display name updated.');
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : 'Failed to update display name');
    } finally {
      setIsSavingName(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    setIsSavingPassword(true);
    try {
      await updateProfile({ newPassword });
      setPasswordMessage('Password updated.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Failed to update password');
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-bold">Profile</h1>

      <form onSubmit={handleNameSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">Display name</h2>
        {nameMessage && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{nameMessage}</p>}
        {nameError && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{nameError}</p>}
        <label className="block text-sm">
          Name
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isSavingName}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSavingName ? 'Saving...' : 'Save name'}
        </button>
      </form>

      <form onSubmit={handlePasswordSubmit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">Change password</h2>
        {passwordMessage && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{passwordMessage}</p>}
        {passwordError && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{passwordError}</p>}
        <label className="block text-sm">
          New password
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Confirm new password
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isSavingPassword}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSavingPassword ? 'Saving...' : 'Save password'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Add a "Forgot password?" link to `LoginPage.tsx`**

In `frontend/src/pages/LoginPage.tsx`, add the import:

```tsx
import { Link, useNavigate } from 'react-router-dom';
```

(replacing the existing `import { useNavigate } from 'react-router-dom';` line), and add this line immediately after the closing `</form>` tag, still inside the outer `<div className="flex min-h-screen ...">`:

```tsx
        <Link to="/forgot-password" className="mt-4 block text-center text-sm text-blue-700 hover:underline">
          Forgot password?
        </Link>
```

- [ ] **Step 5: Add a "Profile" link to `Layout.tsx`**

In `frontend/src/components/Layout.tsx`, add the import:

```tsx
import { NavLink, Outlet } from 'react-router-dom';
```

(already present — no change needed there). In the right-side `<div className="flex items-center gap-3">`, add a `NavLink` to `/profile` before the existing divider/sign-out button:

```tsx
        <div className="flex items-center gap-3">
          <NotificationCenter />
          <NavLink to="/profile" className={linkClass}>
            Profile
          </NavLink>
          <div className="h-4 w-px bg-gray-200"></div>
          <button onClick={logout} className="text-sm text-gray-600 hover:text-gray-900 font-medium">
            Sign out
          </button>
        </div>
```

- [ ] **Step 6: Wire the new routes in `App.tsx`**

Add the imports:

```tsx
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ProfilePage } from './pages/ProfilePage';
```

Add the two public routes as siblings of the existing `<Route path="/login" ...>` (public, outside `ProtectedRoute`):

```tsx
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
```

Add the authenticated `/profile` route inside the existing `<Route element={<Layout />}>` block, alongside `/my-tasks`:

```tsx
                <Route path="/my-tasks" element={<MyTasksPage />} />
                <Route path="/profile" element={<ProfilePage />} />
```

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no output (clean compile).

- [ ] **Step 8: Manual verification**

With both dev servers running (and, for real email delivery, an SMTP relay configured — otherwise read the token directly from the `password_reset_tokens` table in the dev DB, as the spec's testing section describes): go to `/login`, click "Forgot password?", submit a seeded user's email, confirm the generic confirmation message appears. Retrieve the raw token (from a real email, or `SELECT token_hash ...` won't work since it's hashed — instead capture the link from server logs / a local mail catcher, or temporarily log the raw token in dev). Visit `/reset-password?token=<token>`, set a new password, confirm redirect to `/login`, and log in with the new password. Then log in, click "Profile" in the navbar, update the display name, and update the password again, confirming both save independently.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/ForgotPasswordPage.tsx frontend/src/pages/ResetPasswordPage.tsx frontend/src/pages/ProfilePage.tsx frontend/src/pages/LoginPage.tsx frontend/src/components/Layout.tsx frontend/src/App.tsx
git commit -m "feat: add forgot-password, reset-password, and profile pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
