# Self-Service Password Reset & User Profile — Design Spec

Status: Approved for implementation

## 1. Purpose

Two of the last unchecked items in `task.md`'s Core Platform & Security section, and
Tier-1 blocker #5 in `COMMERCIAL_PRODUCT_ROADMAP.md`: today only an admin can set a
user's password (`userService.createUser`), and there is no way for a logged-in user
to change their own name or password. This spec adds:

1. A "Forgot password" email flow (`POST /auth/forgot-password`, `POST /auth/reset-password`).
2. A profile self-service endpoint (`PATCH /users/me`) and page to update display name
   and/or password while logged in.

## 2. Data model

New table `password_reset_tokens` (migration `024_create_password_reset_tokens.js`):

- `id` uuid primary key, `gen_random_uuid()`.
- `tenant_id` uuid not null, FK → `tenants(id)`.
- `user_id` uuid not null, composite FK `(tenant_id, user_id)` → `users(tenant_id, id)`,
  `onDelete('CASCADE')`.
- `token_hash` text not null — SHA-256 hex digest of the raw token. The raw token itself
  is never persisted, mirroring why passwords are hashed rather than stored: a DB read
  (backup, replica, dump) must not hand out a live reset credential.
- `expires_at` timestamp not null.
- `used_at` timestamp, nullable — set when the token is consumed; a used token is
  rejected on any later attempt even if not yet expired.
- `created_at` timestamp, default `now()`.
- Index on `token_hash` (the reset endpoint's lookup key).
- Index on `[tenant_id, user_id]` (used to invalidate a user's prior outstanding tokens).

No changes to `users` — `full_name` and `password_hash` already exist and are exactly
what the profile update writes to.

## 3. Backend

### 3.1 `authService.js` additions

- `requestPasswordReset(email)`:
  1. Look up the user by email (unscoped by tenant, matching `login`'s existing lookup
     — this app resolves users globally by email today, tenant is derived from the
     found row, not from a header).
  2. If no user matches, do nothing and return — the route still responds 200
     regardless (§3.3), so there is no timing/response difference to exploit.
  3. If found: generate a raw token via `crypto.randomBytes(32).toString('hex')`,
     compute `token_hash = sha256(rawToken)`, delete any existing unused tokens for
     that `user_id` (so only the newest link ever works), insert the new row with
     `expires_at = now() + 1 hour`.
  4. Build the reset link: `${FRONTEND_BASE_URL}/reset-password?token=${rawToken}` and
     send it directly via the existing `transporter`/`MAIL_FROM` from
     `config/mailer.js` (`sendMail({ from: MAIL_FROM, to: email, subject, text })`),
     **not** through `notificationService`'s queued `notifications` table — that table
     backs the in-app notification bell (`listNotificationsForUser`), and a live,
     single-use password-reset link has no business sitting in a persisted, in-app
     list. Send inline; wrap in try/catch and log on failure (a dropped reset email
     must not surface as a 500, since the route's response is already generic).
- `resetPassword(rawToken, newPassword)`:
  1. Validate `newPassword` with the same rule `userService` already uses
     (`MIN_PASSWORD_LENGTH = 8`) — export that constant from `userService.js` and
     import it here rather than duplicating the number.
  2. Hash the incoming token (`sha256`) and look up an unexpired, unused
     `password_reset_tokens` row by `token_hash`. Not found / expired / already used →
     `AppError(400, 'This reset link is invalid or has expired')` (safe to be specific
     here — the token itself is the secret, not the response).
  3. In one transaction: bcrypt-hash `newPassword` into that `user_id`'s
     `users.password_hash`, set `used_at = now()` on the token row.

New env var `FRONTEND_BASE_URL` (added to `config/env.js` validation and
`.env.example`, default `http://localhost:5174` for local dev) — the only base-URL
config this app currently has is CORS origins, which is a list, not a single canonical
URL to build a link from.

### 3.2 `userService.js` addition

- `updateOwnProfile(tenantId, userId, { fullName, newPassword })`: at least one of
  `fullName`/`newPassword` must be present (400 otherwise). Updates `full_name` when
  provided (empty string is not allowed — same non-empty rule already implied
  elsewhere); when `newPassword` is provided, validates length and bcrypt-hashes it
  into `password_hash`. No current-password check (per approved design — the caller is
  already authenticated via a valid JWT). Returns the updated
  `{ id, email, full_name, is_admin }`.

### 3.3 Routes

- Extend `backend/src/routes/auth.js`:
  - `POST /auth/forgot-password` — body `{ email }`, calls `requestPasswordReset`,
    **always** responds `200 { message: 'If that email is registered, a reset link has been sent.' }`
    regardless of outcome (the enumeration-safe behavior this spec is built around).
    Reuses `loginLimiter`-style rate limiting (a new limiter instance, same shape) so
    this can't be used to spam a target's inbox.
  - `POST /auth/reset-password` — body `{ token, newPassword }`, calls `resetPassword`,
    200 on success, propagates the 400 from an invalid/expired token via `next(err)`.
- Extend `backend/src/routes/users.js` (already `authenticate`-gated, mounted at
  `/users`):
  - `PATCH /users/me` — body `{ fullName?, newPassword? }`, calls
    `updateOwnProfile(req.user.tenantId, req.user.userId, ...)`.

## 4. Frontend

- `frontend/src/api/auth.ts` (new, or extend existing auth API file if one exists):
  `requestPasswordReset(email)`, `resetPassword(token, newPassword)`,
  `updateProfile({ fullName?, newPassword? })`.
- `frontend/src/pages/ForgotPasswordPage.tsx` — email input, submit, shows the generic
  confirmation message (never a "not found" error, matching the backend's uniform 200).
- `frontend/src/pages/ResetPasswordPage.tsx` — route `/reset-password`, reads `token`
  from `useSearchParams`, new-password + confirm-password fields (client-side match
  check), submits, redirects to `/login` with a success message on 200, shows the
  backend's error message on 400 (e.g. "This reset link is invalid or has expired").
- `frontend/src/pages/ProfilePage.tsx` — display-name field and new-password +
  confirm-password fields, each section independently submittable via
  `updateProfile`; reachable from a new "Profile" link in `Layout.tsx`'s navbar.
- Add a "Forgot password?" link on the existing login page pointing at
  `/forgot-password`.
- New routes in `App.tsx`: `/forgot-password`, `/reset-password` (public, outside the
  authenticated layout), `/profile` (inside the authenticated layout).

## 5. Out of scope

- Current-password verification on profile password change (explicitly declined).
- Rate-limiting reset-password attempts by token (the 1-hour expiry + single-use +
  32-byte random token already makes brute-forcing the token infeasible).
- Any change to `login`'s existing email-lookup behavior.
- Email/username change on the profile page (only display name and password, per
  `task.md`'s own wording: "update display name and password").
- Admin-triggered reset ("send this user a reset link" from the admin users page) —
  not requested; the existing admin-sets-a-password path via `createUser` is unaffected
  and remains available for initial account setup.

## 6. Testing

New `backend/tests/passwordReset.test.js`:
- `POST /auth/forgot-password` for an existing email → 200, exactly one email sent
  (mock `transporter.sendMail`), a `password_reset_tokens` row created for that user.
- `POST /auth/forgot-password` for a non-existent email → 200, identical response body,
  no email sent, no row created.
- Requesting a second reset invalidates the first token (old raw token → 400 on
  `reset-password`).
- `POST /auth/reset-password` with a valid token → 200, password actually changed
  (subsequent login with the old password fails, with the new password succeeds), token
  marked used.
- Reusing an already-used token → 400.
- An expired token (insert with `expires_at` in the past directly via `db`) → 400.
- Weak new password (< 8 chars) → 400, for both reset and profile-update paths.
- `PATCH /users/me` updates `full_name` only, `password_hash` only, and both together;
  401 when unauthenticated; 400 when neither field is provided.
- Cross-tenant isolation: a token issued for tenant A's user cannot be looked up or
  resolved against tenant B state (implicit from the FK/lookup design, asserted
  directly).

Frontend: `tsc -b` clean, then manual click-through — request a reset for a seeded
user, confirm the generic message, retrieve the token directly from the test DB (no
real SMTP in dev unless configured), submit it on `/reset-password`, log in with the
new password, then update the display name and password again from `/profile`.
