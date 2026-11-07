# API

**Living document.** Every endpoint, with its request and response. Update it
in the same commit as any endpoint change. If it and the code disagree, say
which is wrong.

Created: Sprint 1. Last change: Sprint 4b (`POST /payments/:id/cancel`). Before that, Sprint R (the booth flow: tickets at entry, cash and card at the booth, exit requires PAID). The access column is enforced by the global guard and
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
| 401 | No token, a bad or expired token, a refresh token used as an access token, or a session that has ended (logout, deactivation, deletion, role/gate change, password reset) |
| 403 | Signed in, but the role may not call this route |
| 409 | A unique value is taken (category code, location code, username), an idempotency key reused, or the booth refusing a ticket (expired, paid, used, card payment in progress) |

### Sessions

- Access token: 15 minutes. Refresh token: 7 days. Both HS256 JWTs, issuer `qrpark`.
- Every request re-reads the user. A deactivated or deleted user, or a token
  from before the user's last logout, role change, location change or password
  reset, is 401 at once.
- The role checked is the one in the database, never the one in the token.

---

## Access

| Route | Public | ADMIN | ENTRY_OPERATOR | PAYMENT_OPERATOR | EXIT_OPERATOR |
|---|---|---|---|---|---|
| `GET /health` | yes | | | | |
| `POST /auth/login` | yes | | | | |
| `POST /auth/refresh` | yes | | | | |
| `POST /auth/logout` | | yes | yes | yes | yes |
| `GET /admin/categories` | | yes | | | |
| `POST /admin/categories` | | yes | | | |
| `PATCH /admin/categories/:id` | | yes | | | |
| `GET /admin/settings` | | yes | | | |
| `PATCH /admin/settings` | | yes | | | |
| `GET /admin/gates` | | yes | | | |
| `POST /admin/gates` | | yes | | | |
| `PATCH /admin/gates/:id` | | yes | | | |
| `GET /admin/users` | | yes | | | |
| `GET /admin/users/:id` | | yes | | | |
| `POST /admin/users` | | yes | | | |
| `PATCH /admin/users/:id` | | yes | | | |
| `DELETE /admin/users/:id` | | yes | | | |
| `POST /admin/users/:id/password` | | yes | | | |
| `GET /categories` | | | yes | | |
| `POST /tickets` | | | yes | | |
| `GET /tickets/recent` | | | yes (own) | | |
| `GET /tickets/lookup` | | | yes | yes | |
| `POST /tickets/reprint` | | | yes | | |
| `POST /payments/cash` | | | | yes | |
| `POST /payments/card` | | | | yes | |
| `GET /payments/:id` | | | | yes (own) | |
| `POST /payments/:id/cancel` | | | | yes (own) | |
| `POST /paystack/webhook` | signed | | | | |
| `POST /tickets/check` | | | yes | yes | yes |
| `POST /tickets/validate` | | | | | yes |

The old `POST /payments` (a payment that created the ticket) is gone since
Sprint R.

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
{ "displayName": "Garki International Market (TEST)", "paymentWindowMinutes": 5,
  "receiptOrgName": null, "receiptContactLine": null, "updatedAt": "...", "paystackMode": "test" }
```

`paystackMode` is read-only (`"test"` or `"not configured"`), from the
environment. The backend refuses to start with a live key.

### `GET /admin/settings` → 200

### `PATCH /admin/settings` → 200

Any of:

```json
{ "displayName": "...", "paymentWindowMinutes": 5, "receiptOrgName": "...", "receiptContactLine": "..." }
```

- `displayName`: trimmed, 1–100 characters.
- There is no validity setting: a ticket is valid on its day of issue. `validityHours` is refused (400).
- `paymentWindowMinutes`: integer 1–30. How long a PENDING payment blocks its operator.
- `paystackMode` is not accepted (400).
- `receiptOrgName` (the ticket's brand line), `receiptContactLine` (the line beneath): up to 120 characters; `null` or `""` clears.
- Audited: `SETTINGS_CHANGED` with `{ field: { from, to } }` for each field that changed.

---

## Admin: locations (gates and booths)

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

`direction` is the kind: `ENTRY`, `EXIT` or `BOOTH`. 409 if the code exists. Audited: `GATE_CREATED`.

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

Deleted accounts are not listed; `GET`, `PATCH` and `DELETE` of one are 404.

### `POST /admin/users` → 201

```json
{ "username": "entry-2", "name": "Entry two", "role": "ENTRY_OPERATOR", "gateId": "uuid", "password": "12+ characters" }
```

- `username`: trimmed and lower-cased; 3–32 of `a-z 0-9 . _ -`. 409 if taken.
- `password`: at least 12 characters. Hashed with Argon2id; never stored or returned otherwise.
- `role`: `ADMIN`, `ENTRY_OPERATOR`, `PAYMENT_OPERATOR` or `EXIT_OPERATOR`. One job per account.
- `gateId`: required for an operator, an in-service location of the job's kind
  (ENTRY for an `ENTRY_OPERATOR`, BOOTH for a `PAYMENT_OPERATOR`, EXIT for an
  `EXIT_OPERATOR`); absent or `null` for an `ADMIN`.
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

### `DELETE /admin/users/:id` → 200

A **soft delete**: the account disappears from the list and every picker,
cannot sign in or refresh, and its sessions end at once; its username can be
reused; its history stays (tickets, payments, scans and audit rows still name
it). Returns `{ "id": "uuid", "deleted": true }`.

- Refused (400): deleting **yourself**, or the **last active admin** (safe under
  concurrent requests: the site's admin rows are locked first).
- Audited: `USER_DELETED` `{ username, role }`.

### `POST /admin/users/:id/password` → 200

```json
{ "password": "12+ characters" }
```

Returns `{ "id": "uuid", "passwordSet": true }`. Ends the user's sessions.
Audited: `USER_PASSWORD_RESET` `{ username }` (never the password).

---

## The booth flow: shared rules

Sprint R (2026-11-07). Entry creates an UNPAID ticket; the payment booth takes
cash or card; exit requires PAID (`docs/01-flow.md`).

- **Location rules** (in code; the database does not check them): a ticket is
  created only by an ENTRY_OPERATOR whose location is an in-service ENTRY gate;
  cash and card only by a PAYMENT_OPERATOR at an in-service BOOTH; validate only
  by an EXIT_OPERATOR at an in-service EXIT gate; check by each job at its own
  kind of location. Refused: 400, nothing written.
- **`X-Device-Id`** (the app's installation id, 1–64 of `A-Z a-z 0-9 _ -`) is
  required on `POST /tickets`, `POST /payments/cash`, `POST /payments/card`,
  `POST /tickets/validate` and `POST /tickets/check`. Missing or invalid: 400,
  nothing written, the value never echoed.
- **Idempotency keys** (16–100 of `A-Z a-z 0-9 _ -`, one per attempt, a UUID
  from the app) on `POST /tickets`, `POST /payments/cash` and
  `POST /payments/card`. The same key from the same operator for the same
  request returns the first result (200). The same key from another operator,
  or for a different request, is 409 and returns nothing of the first.
- **The token** (the QR) is returned only to the entry operator who created the
  ticket (`POST /tickets`) and on a reprint. It is never in a check, lookup,
  payment or recent-list response, never logged, never in an error message.
- **Expiry** is decided on the database clock: a ticket is valid while
  `now() < valid_until`, and `valid_until` is the start of the next Lagos day
  after it was issued. "Today's tickets" are those with
  `valid_until = lagos_day_end(now())`.
- **Malformed JSON** gets `400 The request body is not valid JSON`, which
  quotes nothing of the body.

### The ticket summary (no token)

Used by check, lookup, recent and payment responses.

```json
{ "id": "uuid", "ticketNumber": "K7MP-3QZ9", "categoryName": "Car", "feeKobo": 50000,
  "issuedAt": "...", "validUntil": "...", "state": "UNPAID",
  "paymentStatus": "UNPAID", "validationStatus": "NOT_VALIDATED",
  "paidAt": null, "paymentMethod": null }
```

`state` is one word for the screen: `UNPAID`, `PAID`, `VALIDATED` or `EXPIRED`
(not validated and past `validUntil`; paid or not).

---

## Entry (entry operators)

### `GET /categories` → 200

Active categories with the backend's price. The app shows this price; it
never computes or edits one.

```json
[{ "code": "CAR", "name": "Car", "priceKobo": 50000 }]
```

### `POST /tickets` → 201 (new) or 200 (repeat of the same key)

Header `X-Device-Id`.

```json
{ "categoryCode": "CAR", "idempotencyKey": "3f1c2a90-6b1e-4c5d-9a7e-0b2c4d6e8f10" }
```

Creates the ticket at once: UNPAID, NOT_VALIDATED, the fee snapshot from the
category's price now, `valid_until` set by the database. No price, name or
time is accepted (400 for any other field).

Response, the full ticket **with the token** (to print):

```json
{ "id": "uuid", "ticketNumber": "K7MP-3QZ9", "token": "<43 characters: the QR content>",
  "categoryCode": "CAR", "categoryName": "Car", "feeKobo": 50000,
  "issuedAt": "...", "validUntil": "...", "paymentStatus": "UNPAID", "validationStatus": "NOT_VALIDATED",
  "gate": { "code": "ENTRY_1", "name": "Entry 1" }, "operator": { "name": "..." },
  "header": { "displayName": "...", "receiptOrgName": null, "receiptContactLine": null } }
```

Errors: unknown category 404; retired 400; wrong role 403; wrong or
out-of-service location 400; idempotency key reused by another operator or for
a different category 409.

### `GET /tickets/recent` → 200

The caller's own tickets issued **today**, newest first, at most 50. Ticket
summaries (no token).

### `GET /tickets/lookup?suffix=XYZ` (ENTRY_OPERATOR, PAYMENT_OPERATOR) → 200

Customers quote the last characters of the ticket number. `suffix`: 3 or more
characters, case-insensitive, hyphen optional (`3qz9`, `P-3QZ9`). Returns
**today's** tickets whose number ends with it, newest first, at most 20, as
ticket summaries (never the token). No match, a too-short or malformed suffix:
`404 No ticket found`, the same for every miss.

### `POST /tickets/reprint` (ENTRY_OPERATOR) → 200

```json
{ "ticketId": "uuid" }
```

The same QR (the full ticket, with the token) for a ticket issued **today** and
**not validated**. Any entry operator of the site may reprint. Every miss
(unknown, malformed, another day, validated) is `404 No active ticket found`,
the same for all, and nothing is audited. Audited: `TICKET_REPRINTED` by the
reprinting operator, detail `{ ticketNumber, issuedBy: { id, username } }`.

---

## Booth (payment operators)

Both payment routes take **either** a scanned token **or** a ticket id (after a
lookup), never both, plus an idempotency key, with the `X-Device-Id` header.
The amount is **always** the ticket's `feeKobo`; nothing about money comes
from the client.

```json
{ "token": "<scanned>", "idempotencyKey": "..." }
{ "ticketId": "uuid", "idempotencyKey": "..." }
```

Refused, **409, nothing written** (checked on the database clock, inside the
same transaction as the write):

| `message` | When |
|---|---|
| `Ticket has expired` | issued on an earlier day |
| `Ticket is already paid` | PAID |
| `Ticket has already been used` | VALIDATED |
| `A card payment for this ticket is in progress` | a PENDING card payment exists for the ticket (`pendingPaymentId` in the body) |

An unknown ticket (id or token) is 404 `No ticket found`; a token of the wrong
shape is the same 404.

### `POST /payments/cash` → 201 (new) or 200 (repeat of the same key)

Records the cash and marks the ticket PAID, in one transaction (the ticket row
is locked first, then its payments: the same order everywhere). One tap is the
confirmation; a repeated tap with the same key returns the same payment.
Audited: `PAYMENT_CASH_CONFIRMED` `{ ticketNumber, amountKobo, reference }`.

```json
{ "id": "uuid", "reference": "QRP_...", "method": "CASH", "status": "SUCCESS", "amountKobo": 50000,
  "createdAt": "...", "paidAt": "...", "authorizationUrl": null, "accessCode": null,
  "ticket": { ...the ticket summary, now PAID... } }
```

### `POST /payments/card` → 201 (new) or 200 (repeat of the same key)

Starts a Paystack checkout for the ticket's fee (the Sprint 2 flow, now against
a ticket): the per-operator Redis lock (fails closed: 503 when Redis is down),
one PENDING payment per ticket and per operator, the delayed checks.

- Another card payment PENDING for this ticket, or for this operator: 409 with
  `pendingPaymentId`. A PENDING one past the payment window is first checked
  with Paystack.
- Paystack refuses: 502 `{ message, paymentId }`, the payment ABANDONED.
  Paystack does not answer: 503 `{ message, outcome: "unknown", paymentId }`,
  the payment stays PENDING and is checked.
- Paystack not configured: 503, nothing written.

Response: the payment view (as above) with `status: "PENDING"` and the checkout
in `authorizationUrl` / `accessCode`.

### `GET /payments/:id` (PAYMENT_OPERATOR, own) → 200

The caller's own payment; any other id is 404. Poll it until `status` is not
PENDING. `authorizationUrl` and `accessCode` only while PENDING. The ticket
summary, never the token.

### `POST /payments/:id/cancel` (PAYMENT_OPERATOR, own, at an in-service BOOTH) → 200

Sprint 4b; closes T7. Cancels the caller's own **PENDING card** payment when the
customer gives up on the card (then cash, or a new card payment, works at once:
the pending slots of the ticket and the operator are free).

```json
{ "force": true }
```

The body is optional; `force` (boolean) is its only field, and it counts only
when Paystack could not be reached.

- Any other id (another operator's, a cash payment, unknown, malformed): `404 Unknown payment`.
- **Too early**: a payment may be cancelled **60 seconds** after it started
  (its `created_at`, database clock). Before that: `409` with
  `{ message, allowedAt }`; Paystack is not asked.
- Already **SUCCESS** or **DUPLICATE**: `409`, nothing changed.
- Already **ABANDONED** or **FAILED**: `200` `outcome: "ALREADY_ENDED"`, nothing changed.
- **PENDING**: Paystack is asked once (verify, 15 s limit), outside any lock:

| Paystack says | Result |
|---|---|
| paid | settled as normal (SUCCESS, ticket PAID, or DUPLICATE); `outcome: "ALREADY_PAID"`; nothing cancelled |
| failed | the payment FAILED; `outcome: "FAILED"` |
| not paid (pending, abandoned) or no such transaction | the payment **ABANDONED**, the ticket untouched; `outcome: "CANCELLED"`, `forced: false` |
| no answer | `503` `{ message: "...cannot be confirmed...", outcome: "unknown", canForce: true }`, still PENDING; with `force: true`: **ABANDONED**, `outcome: "CANCELLED"`, `forced: true` |

The write locks the ticket row, then the payment, and re-reads the payment: if
a webhook settled it meanwhile, nothing is cancelled (`ALREADY_PAID`).
Audited (every cancel, forced or not, with the operator):
`PAYMENT_CANCELLED` `{ ticketNumber, forced }`.

```json
{ "outcome": "CANCELLED", "forced": false, "payment": { ...the payment view, status ABANDONED... } }
```

A Paystack SUCCESS that arrives after a cancel still settles the payment (see
below): LATE_SUCCESS (ticket PAID), or DUPLICATE if the ticket was paid by cash
meanwhile. **The idempotency key of a cancelled attempt replays the cancelled
payment**: "Try card again" needs a new key.

### How a card payment ends

A card payment leaves PENDING only on Paystack's word (signed webhook, or a
verify check at 20, 45, 90, 150 and 240 s inside the payment window, then the
2-minute sweep). Paystack's amount must equal the ticket's fee (kobo) in NGN,
or nothing happens. In the same transaction (ticket row locked first):

- **SUCCESS**: the payment SUCCESS and the ticket PAID.
- **Ticket already PAID** (for example cash was taken, then the customer finished
  the checkout): the payment becomes **DUPLICATE**, keeps Paystack's time and
  payload, the ticket is not touched, and an ERROR `DOUBLE_PAYMENT` with the
  reference is logged. Not revenue: refund it in the Paystack dashboard.
- **Ticket expired**: the payment SUCCESS and the ticket PAID; it stays EXPIRED
  and cannot exit; a `LATE_SUCCESS_EXPIRED` warning is logged.
- **Late SUCCESS after ABANDONED or FAILED**: accepted, `LATE_SUCCESS` warning.
- FAILED on Paystack's failure; ABANDONED past the window when Paystack says it
  is not paid, or at once when Paystack has no such transaction and never gave
  a checkout. No answer from Paystack changes nothing. The sweep touches only
  PENDING payments, so a DUPLICATE is never reprocessed.

---

## Paystack webhook

### `POST /paystack/webhook` (signed) → 200

Paystack's own call. The `x-paystack-signature` header must be the
HMAC-SHA512 of the exact request bytes with the secret key.

- Bad or missing signature: **401**, nothing changes.
- Valid signature, unknown reference: **200**, nothing changes.
- Valid `charge.success`: settles as above (idempotent: a repeat, even at the
  same moment, changes nothing more). Valid `charge.failed`: PENDING → FAILED.
  Any other event: 200, nothing changes.

Response: `{ "received": true }`.

---

## Scans: validate and check

Both routes take the scanned text, with the `X-Device-Id` header, and **every
request that reaches a scan result writes one `scan_event`** (location,
operator, `device_ref`, database time; the ticket when one was found). A
request refused before that (401, 403, a 400 for a bad body, header or
location) writes nothing.

```json
{ "token": "<the scanned text>" }
```

`token`: a string of at most 2,048 characters (400 otherwise), trimmed. A
string not of the token's shape is the result `INVALID_QR`, decided before any
database lookup.

### `POST /tickets/validate` (EXIT_OPERATOR, at an in-service EXIT gate) → 200

ONE conditional statement, on the database clock:

```sql
UPDATE ticket SET validation_status = 'VALIDATED', validated_at = now(), validated_gate_id = $gate, validated_by_id = $operator
WHERE site_id = $site AND token = $1
  AND payment_status = 'PAID' AND validation_status = 'NOT_VALIDATED' AND now() < valid_until
RETURNING ...
```

Of any number of simultaneous validations of one ticket, exactly one is
`VALID`. The update and the scan record commit together. If the update changed
nothing, one read (which never writes) decides, in this order:

1. VALIDATED → `ALREADY_USED`
2. expired → `EXPIRED`
3. UNPAID → `PAYMENT_REQUIRED`
4. no ticket → `NOT_FOUND`
5. anything else (PAID, not validated, not expired: impossible after the update)
   → **503 `Cannot verify`**, never VALID.

### `POST /tickets/check` (all three operator jobs, each at its own kind of location) → 200

**Read-only**: never changes the ticket. The same order, with `ACTIVE` (paid,
not validated, not expired) in place of `VALID`.

### Response (both routes)

| `result` | Route | Screen | Extra fields |
|---|---|---|---|
| `VALID` | validate | Green "Valid — allow exit" | `ticket` |
| `ACTIVE` | check | Paid, not used, valid today | `ticket` |
| `PAYMENT_REQUIRED` | both | Red "Payment required — go to the payment booth" (the booth shows "Take payment ₦N") | `ticket` |
| `ALREADY_USED` | both | Red "Already used" | `usedAt`, `usedGate`, `usedBy`, `usedByYou`, `ticket` |
| `EXPIRED` | both | Red "Expired" | `validUntil`, `ticket` |
| `NOT_FOUND` | both | Red "Ticket not found" | none |
| `INVALID_QR` | both | Red "Not one of our tickets" | none |

`ticket` is the ticket summary (never the token). `scannedAt` is the scan
record's database time.

```json
{ "result": "ALREADY_USED", "scannedAt": "...",
  "usedAt": "...", "usedGate": { "code": "EXIT_1", "name": "Exit 1" },
  "usedBy": { "name": "...", "username": "exit-1" }, "usedByYou": false,
  "ticket": { ...summary... } }
```

- `usedByYou` is true when the calling operator closed the ticket. **A retry
  is never re-approved**: if a `VALID` reply was lost and the operator scans
  again, the answer is `ALREADY_USED` with `usedByYou: true`.

### Errors

| Status | When | App shows |
|---|---|---|
| 400 | bad body or header, or the operator's location does not allow it | the message |
| 401 / 403 | not signed in / wrong role | sign-in / refusal |
| 503 `Cannot verify` | the backend cannot decide safely | Grey "Cannot verify"; **never** "Valid" |
| 5xx, or no connection | anything else | Grey "Cannot verify — no connection"; never "Valid" |

There is no offline approval and no bypass: only a `VALID` result from this
backend lets a vehicle out.
