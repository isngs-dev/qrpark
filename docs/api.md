# API

**Living document.** Every endpoint, with its request and response. Update it
in the same commit as any endpoint change. If it and the code disagree, say
which is wrong.

Created: Sprint 1. The access column is enforced by the global guard and
pinned by `backend/src/auth/routes.lifecycle.test.ts`, which fails if a route
is added without being listed there.

---

## Conventions

| Rule | Detail |
|---|---|
| Format | JSON in and out. `content-type: application/json` |
| Auth | `Authorization: Bearer <accessToken>` on every route that is not **public** |
| Unknown fields | Refused with 400 (not ignored) |
| Money | Integer **kobo**, as a JSON number. `"500"` (a string) and `1.5` are refused |
| Time | ISO 8601 UTC, set by the backend. The client never sends a time |
| Ids | UUIDs. A malformed id in a path is 400; an id from another site or none is 404 |
| Errors | Nest's shape: `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`. `message` may be an array for validation errors |

### Status codes

| Code | Meaning |
|---|---|
| 401 | No token, a bad or expired token, a refresh token used as an access token, or a session that has ended (logout, deactivation, role/gate change, password reset) |
| 403 | Signed in, but the role may not call this route |
| 409 | A unique value is taken (category code, gate code, username) |

### Sessions

- Access token: 15 minutes. Refresh token: 7 days. Both HS256 JWTs, issuer `qrpark`.
- Every request re-reads the user. A deactivated user, or a token from before
  the user's last logout, role change, gate change or password reset, is 401
  at once.
- The role checked is the one in the database, never the one in the token.

---

## Access

| Route | Public | ADMIN | ENTRY_OPERATOR | EXIT_OPERATOR |
|---|---|---|---|---|
| `GET /health` | yes | | | |
| `POST /auth/login` | yes | | | |
| `POST /auth/refresh` | yes | | | |
| `POST /auth/logout` | | yes | yes | yes |
| `GET /admin/categories` | | yes | | |
| `POST /admin/categories` | | yes | | |
| `PATCH /admin/categories/:id` | | yes | | |
| `GET /admin/settings` | | yes | | |
| `PATCH /admin/settings` | | yes | | |
| `GET /admin/gates` | | yes | | |
| `POST /admin/gates` | | yes | | |
| `PATCH /admin/gates/:id` | | yes | | |
| `GET /admin/users` | | yes | | |
| `GET /admin/users/:id` | | yes | | |
| `POST /admin/users` | | yes | | |
| `PATCH /admin/users/:id` | | yes | | |
| `POST /admin/users/:id/password` | | yes | | |

A route with no `@Roles()` is refused for every role (the guard fails closed).

---

## Health

### `GET /health` (public)

Always 200 while the process is up.

```json
{ "status": "ok", "database": "up", "redis": "up", "time": "2026-11-06T05:47:21.655Z" }
```

`status` is `"degraded"` when either dependency is `"down"`.

---

## Auth

### `POST /auth/login` (public) → 200

```json
{ "username": "entry-1", "password": "..." }
```

The username is matched case-insensitively (usernames are stored lower-case).

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "user": { "id": "uuid", "username": "entry-1", "name": "Test entry operator 1", "role": "ENTRY_OPERATOR" },
  "gate": { "id": "uuid", "code": "ENTRY_1", "name": "Test entry 1", "direction": "ENTRY" },
  "site": { "code": "garki-test", "displayName": "Garki International Market (TEST)" }
}
```

`gate` is `null` for an ADMIN. The app takes its mode from `user.role` and shows `gate`.

401 `Invalid username or password` for a wrong password, an unknown username
and an inactive account alike.

### `POST /auth/refresh` (public) → 200

```json
{ "refreshToken": "..." }
```

Same response as login. 401 if the token is not a refresh token, has expired,
or the session has ended.

### `POST /auth/logout` (any signed-in role) → 204

No body. Ends **every** session of the caller: all their access and refresh
tokens are refused from now on.

---

## Admin: vehicle categories and prices

A category view:

```json
{ "id": "uuid", "code": "CAR", "name": "Car", "priceKobo": 50000, "isActive": true,
  "createdAt": "...", "updatedAt": "..." }
```

### `GET /admin/categories` → 200

All categories, active first, then by name.

### `POST /admin/categories` → 201

```json
{ "code": "CAR", "name": "Car", "priceKobo": 50000 }
```

- `code`: upper-cased; 1–32 of `A-Z 0-9 _`, starting with a letter. Never changes after creation.
- `priceKobo`: integer, 1 to 2147483647.
- 409 if the code exists. Audited: `CATEGORY_CREATED` `{ code, name, priceKobo }`.

### `PATCH /admin/categories/:id` → 200

Any of:

```json
{ "name": "Car", "priceKobo": 55000, "isActive": false }
```

- `code` is not accepted (400).
- `null` for any field is 400.
- A price change is audited as `CATEGORY_PRICE_CHANGED` `{ code, priceKobo: { from, to } }`;
  a name or active change as `CATEGORY_UPDATED` `{ code, name?: {from,to}, isActive?: {from,to} }`.
- A payment already started keeps its own price snapshot.
- 400 `Nothing to change` if nothing differs.

---

## Admin: settings

A settings view:

```json
{ "displayName": "Garki International Market (TEST)", "validityHours": 12,
  "receiptOrgName": null, "receiptContactLine": null, "updatedAt": "..." }
```

### `GET /admin/settings` → 200

### `PATCH /admin/settings` → 200

Any of:

```json
{ "displayName": "...", "validityHours": 12, "receiptOrgName": "...", "receiptContactLine": "..." }
```

- `displayName`: trimmed, 1–100 characters.
- `validityHours`: integer 1–72. Applies to tickets issued after the change only.
- `receiptOrgName`, `receiptContactLine`: up to 120 characters; `null` or `""` clears.
- Audited: `SETTINGS_CHANGED` with `{ field: { from, to } }` for each field that changed.

---

## Admin: gates

A gate view:

```json
{ "id": "uuid", "code": "ENTRY_1", "name": "Entry 1", "direction": "ENTRY", "isActive": true,
  "createdAt": "...", "updatedAt": "..." }
```

### `GET /admin/gates` → 200

### `POST /admin/gates` → 201

```json
{ "code": "ENTRY_1", "name": "Entry 1", "direction": "ENTRY" }
```

`direction` is `ENTRY` or `EXIT`. 409 if the code exists. Audited: `GATE_CREATED`.

### `PATCH /admin/gates/:id` → 200

```json
{ "name": "Entry one", "isActive": false }
```

`code` and `direction` are not accepted (400). Audited: `GATE_UPDATED`.

---

## Admin: users

A user view (never a password or hash):

```json
{ "id": "uuid", "username": "entry-1", "name": "...", "role": "ENTRY_OPERATOR", "isActive": true,
  "gate": { "id": "uuid", "code": "ENTRY_1", "name": "...", "direction": "ENTRY" },
  "createdAt": "...", "updatedAt": "..." }
```

### `GET /admin/users` → 200 · `GET /admin/users/:id` → 200

### `POST /admin/users` → 201

```json
{ "username": "entry-2", "name": "Entry two", "role": "ENTRY_OPERATOR", "gateId": "uuid", "password": "12+ characters" }
```

- `username`: trimmed and lower-cased; 3–32 of `a-z 0-9 . _ -`. 409 if taken.
- `password`: at least 12 characters. Hashed with Argon2id; never stored or returned otherwise.
- `gateId`: required for an operator (an in-service gate facing ENTRY for an
  `ENTRY_OPERATOR`, EXIT for an `EXIT_OPERATOR`); absent or `null` for an `ADMIN`.
- Audited: `USER_CREATED` `{ username, role, gateCode }`.

### `PATCH /admin/users/:id` → 200

Any of:

```json
{ "name": "...", "role": "EXIT_OPERATOR", "gateId": "uuid", "isActive": false }
```

- No `username` and no `password` (400).
- The resulting role and gate must satisfy the gate rule above. Promoting to
  `ADMIN` drops the gate.
- Refused (400): an admin deactivating or demoting **themselves**, and any change
  that would leave the site with **no active admin** (safe under concurrent requests).
- A role change, gate change or deactivation **ends the user's sessions**.
- Audited: `USER_UPDATED` `{ username, name?, role?, gateCode?, isActive? }`, each `{ from, to }`.

### `POST /admin/users/:id/password` → 200

```json
{ "password": "12+ characters" }
```

Returns `{ "id": "uuid", "passwordSet": true }`. Ends the user's sessions.
Audited: `USER_PASSWORD_RESET` `{ username }` (never the password).
