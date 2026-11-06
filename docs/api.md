# API

**Living document.** Every endpoint, with its request and response. Update it
in the same commit as any endpoint change. If it and the code disagree, say
which is wrong.

Created: Sprint 1. Last change: Sprint 2 (payments, webhook, tickets). The access column is enforced by the global guard and
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
| `GET /categories` | | | yes | |
| `POST /payments` | | | yes | |
| `GET /payments/:id` | | | yes (own) | |
| `POST /paystack/webhook` | signed | | | |
| `GET /tickets/recent` | | | yes (own) | |
| `POST /tickets/reprint` | | | yes | |

A route with no `@Roles()` is refused for every role (the guard fails closed).

**signed**: no token; the Paystack signature authenticates it. Without a valid
signature it is 401, whatever token is sent.

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
{ "displayName": "Garki International Market (TEST)", "validityHours": 12, "paymentWindowMinutes": 5,
  "receiptOrgName": null, "receiptContactLine": null, "updatedAt": "...", "paystackMode": "test" }
```

`paystackMode` is read-only (`"test"` or `"not configured"`), from the
environment. The backend refuses to start with a live key.

### `GET /admin/settings` → 200

### `PATCH /admin/settings` → 200

Any of:

```json
{ "displayName": "...", "validityHours": 12, "paymentWindowMinutes": 5, "receiptOrgName": "...", "receiptContactLine": "..." }
```

- `displayName`: trimmed, 1–100 characters.
- `validityHours`: integer 1–72. Applies to tickets issued after the change only.
- `paymentWindowMinutes`: integer 1–30. How long a PENDING payment blocks its operator.
- `paystackMode` is not accepted (400).
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

---

## Payments (entry operators)

### `GET /categories` → 200

Active categories with the backend's price. The app shows this price; it
never computes or edits one.

```json
[{ "code": "CAR", "name": "Car", "priceKobo": 50000 }]
```

### `POST /payments` → 201 (new) or 200 (repeat of the same key)

```json
{ "categoryCode": "CAR", "customerName": "Ada Obi", "idempotencyKey": "3f1c2a90-6b1e-4c5d-9a7e-0b2c4d6e8f10" }
```

- `categoryCode`: case-insensitive. Unknown 404; retired 400. **No price field**
  is accepted (400): the backend copies the category's price onto the payment.
- `customerName`: optional, trimmed, up to 100; blank is none.
- `idempotencyKey`: 16–100 of `A-Z a-z 0-9 _ -`, one per entry attempt (a UUID).
  The same key from the same operator with the same request returns the same
  payment (200). The same key from **another operator**, or with a different
  category or name, is 409 and returns nothing of that payment.
- The operator's gate must be in service and face ENTRY (400 otherwise).
- **One payment in progress per operator.** While one is PENDING, a new one is
  409 with `{ "pendingPaymentId": "uuid" }`. A PENDING payment older than the
  payment window is first checked with Paystack: if paid it settles (and gets
  its ticket); if not, it is ABANDONED and the new one starts.
- Redis unreachable: 503, nothing written (the payment lock fails closed).
- Paystack not configured: 503, nothing written.

Response (the payment view):

```json
{ "id": "uuid", "reference": "QRP_0123456789abcdef01234567", "status": "PENDING",
  "categoryCode": "CAR", "categoryName": "Car", "amountKobo": 50000, "customerName": "Ada Obi",
  "createdAt": "...", "paidAt": null,
  "authorizationUrl": "https://checkout.paystack.com/...", "accessCode": "...", "ticket": null }
```

`authorizationUrl` and `accessCode` are the Paystack checkout, present only
while PENDING. The app opens it and then **waits**: closing the checkout is
never success.

When Paystack answers badly:

| Paystack | Response | Payment |
|---|---|---|
| refuses (a clear "no") | 502 `{ message, paymentId }` | ABANDONED; the operator can start again |
| does not answer (timeout, 5xx, unreadable) | 503 `{ message, outcome: "unknown", paymentId }` | stays PENDING (Paystack may have it); checked within ~3 s; blocks a second charge |

### `GET /payments/:id` → 200

The operator's **own** payment only; any other id is 404. Poll this until
`status` is not PENDING. Once SUCCESS, `ticket` is the full ticket view
(below), **including the QR token**, for printing.

### How a payment ends

A payment leaves PENDING only on Paystack's word:

- **SUCCESS**: a signed `charge.success` webhook, or Paystack's verify
  saying success. Paystack's amount must equal ours (kobo) in NGN, or nothing
  happens. The ticket is created in the same transaction.
- **FAILED**: a signed `charge.failed`, or verify saying failed.
- **ABANDONED**: Paystack refused to start it; or Paystack has no such
  transaction and never gave us a checkout; or, past the payment window,
  Paystack says it is not paid.
- A background check runs ~20 s after the start (in case no webhook comes),
  and a sweep every 2 minutes checks every PENDING payment older than 20 s.
  No answer from Paystack changes nothing.
- **A late SUCCESS is accepted.** If Paystack confirms a payment already
  ABANDONED or FAILED, it becomes SUCCESS, the ticket is issued (it appears in
  the operator's recent list) and a `LATE_SUCCESS` warning is logged.

> **Known double-charge case.** A late SUCCESS on an abandoned checkout, plus
> a second payment the operator started for the same customer meanwhile, means
> the customer paid twice and holds two tickets. Resolve it by **refunding one
> payment in the Paystack dashboard** (this app does not issue refunds); the
> `LATE_SUCCESS` log line names the reference.

---

## Paystack webhook

### `POST /paystack/webhook` (signed) → 200

Paystack's own call. The `x-paystack-signature` header must be the
HMAC-SHA512 of the exact request bytes with the secret key.

- Bad or missing signature: **401**, nothing changes.
- Valid signature, unknown reference: **200**, nothing changes.
- Valid `charge.success`: settles (idempotent: a repeat, even at the same
  moment, makes no second ticket). Valid `charge.failed`: PENDING → FAILED.
  Any other event: 200, nothing changes.

Response: `{ "received": true }`.

---

## Tickets (entry operators)

The ticket view (from `GET /payments/:id` and `POST /tickets/reprint` only):

```json
{ "id": "uuid", "ticketNumber": "K7MP-3QZ9", "token": "<43 characters: the QR content>",
  "state": "ACTIVE", "categoryName": "Car", "amountKobo": 50000, "customerName": "Ada Obi",
  "paymentReference": "QRP_...", "paidAt": "...", "validUntil": "...", "issuedAt": "...",
  "gate": { "code": "ENTRY_1", "name": "..." }, "operator": { "name": "..." },
  "header": { "displayName": "...", "receiptOrgName": null, "receiptContactLine": null } }
```

- `token` is the only thing in the QR. It is never logged and never in an audit row.
- `state` is `ACTIVE`, `USED` or `EXPIRED` (ACTIVE and past `validUntil`).
- `validUntil` = `paidAt` + the site's validity hours **at issue time**.

### `GET /tickets/recent` → 200

The caller's own tickets issued in the last 24 hours, newest first, at most
50. **Without the token**: print through `GET /payments/:paymentId` (first
print) or reprint.

```json
[{ "id": "uuid", "paymentId": "uuid", "ticketNumber": "K7MP-3QZ9", "state": "ACTIVE",
   "categoryName": "Car", "amountKobo": 50000, "customerName": null,
   "paidAt": "...", "validUntil": "...", "issuedAt": "..." }]
```

### `POST /tickets/reprint` → 200

```json
{ "ticketId": "uuid" }
```

or

```json
{ "ticketNumber": "k7mp3qz9" }
```

- Exactly one of the two (400 otherwise). The number is case-insensitive, hyphen optional.
- **Any entry operator of the site** may reprint; the same QR is returned (the ticket view).
- **ACTIVE tickets only.** Used, expired, unknown and malformed all get the
  same 404 `No active ticket found`, and nothing is audited.
- Audited: `TICKET_REPRINTED` by the reprinting operator, detail
  `{ ticketNumber, via: "id" | "number", issuedBy: { id, username } }`.
