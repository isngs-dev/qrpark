# 04 — Sprints

One sprint at a time. Each sprint ends with its checklist passing, evidence
reported (raw test output, screenshots), files staged, and the user
committing. Do not start the next sprint until told.

---

## Sprint 0 — Repository and skeleton

- `git init`; monorepo folders `backend/`, `admin/`, `android/`, `docs/`.
- `.gitignore` (node_modules, build outputs, `.env`, keystores, `.kotlin/`,
  `.claude/`).
- Backend: NestJS app with `/health`, Prisma wired to Postgres, Redis wired,
  Docker Compose for local Postgres + Redis, one passing test.
- Admin: Next.js + Tailwind app that builds, with a placeholder login page.
- Android: Kotlin project that builds a debug APK, minSdk 29, with a placeholder
  screen.
- CI (GitHub Actions): backend tests, admin build.
- Read `docs/06-reuse-from-eparking.md` and list which eparking files you will
  copy in later sprints.

**Checklist:** `docker compose up` + backend `/health` OK; backend test passes;
admin builds; debug APK builds; CI file present; nothing from eparking modified.

---

## Sprint 1 — Data model, auth, configuration

- Prisma schema: `site`, `app_user` (roles, gate), `gate` (ENTRY/EXIT),
  `vehicle_category` (code, name, price_kobo, active), `site_setting`
  (validity_hours, display name, receipt details), `payment`, `ticket`,
  `scan_event`, `audit_log`. Every table carries a site reference.
- Constraints: unique ticket token; unique ticket number; unique payment
  reference; unique idempotency key; one PENDING payment per operator (partial
  unique index); one ticket per payment.
- Create **`docs/schema.md`**.
- Auth: login, refresh, logout, guards per role, Argon2, 12+ char passwords.
- Config services and admin endpoints for categories, prices, settings, gates,
  users, with audit.
- Seed scripts: `seed-site` (site + first admin from env), `seed-test-data`
  (only for a site code ending `-test`; categories CAR, SUV, BIKE, VAN, TRUCK,
  LORRY with TEST VALUE prices; gates ENTRY_1, EXIT_1; one entry and one exit
  operator; passwords printed once).
- Tests first for access control and price validation (integer kobo, > 0).

**Checklist:** migrations apply on an empty DB; schema.md matches; role tests
fail when a guard is removed; seeds are idempotent.

---

## Sprint 2 — Payments and ticket issue

- Create **`docs/api.md`**.
- `GET /categories` (active, with price) for operators.
- `POST /payments` (category code, optional name, idempotency key) → snapshot
  price, PENDING payment, lock, Paystack initialize, return checkout data.
- `POST /paystack/webhook`: signature check, idempotent settle/fail.
- Verify fallback after ~20 s; background re-check job; payment window →
  ABANDONED.
- Ticket created in the same transaction as SUCCESS: opaque token, ticket
  number, `valid_until` from validity hours.
- `GET /payments/:id` for the app to poll (state + ticket when issued).
- `GET /tickets/recent` (operator's own) and reprint log endpoint.
- Tests first: no ticket for PENDING/FAILED/ABANDONED; webhook replay creates no
  second ticket; bad signature ignored; double tap returns the same payment;
  second payment while one is pending is refused; price change after start
  does not change the payment; amounts are integers.

**Checklist:** all of the above proven, including fail-when-removed for the
signature check, idempotency and the "ticket only on SUCCESS" rule.

---

## Sprint 3 — Validation and check

- `POST /tickets/validate` (EXIT_OPERATOR): one conditional update; returns
  VALID / ALREADY_USED / EXPIRED / NOT_FOUND / INVALID_QR with details; writes a
  scan_event every time.
- `POST /tickets/check` (both operator roles): read-only, same result shape,
  writes a scan_event.
- Token format check before any database lookup (INVALID_QR).
- Tests first: concurrent validation of one ticket by two requests gives exactly
  one VALID; expired ticket refused; check never changes state; scans logged
  without logging the token.

**Checklist:** concurrency test passes repeatedly and fails if the conditional
update is replaced by read-then-write.

---

## Sprint 4 — Android app

- Login, session, refresh; mode from role; gate shown.
- Entry: name, vehicle type list from backend, amount display, Take payment
  (Paystack checkout, as eparking's POS), wait for confirmation, ticket screen,
  print (Android print), reprint from recent list.
- Exit: focused field, scanner (keyboard-wedge) + camera scan, Validate, result
  screen, Next.
- Check ticket in both modes.
- Adapters: payment (checkout), printer (Android print), scanner (camera +
  wedge), chosen by capability. No device names in code.
- Release build signed, HTTPS only, APK named with version, build number and
  commit.

**Checklist:** unit tests for state handling; screenshots of every screen and
every exit result; a scan never validates by itself; no price logic in the app.

---

## Sprint 5 — Admin Portal

- Login; vehicle types & prices; settings; gates & operators; transactions
  (search, filters, detail with scans); open tickets and expired-without-exit
  tracker; dashboard; CSV export.
- Naira display from kobo; Lagos times.

**Checklist:** screenshots of each page; a price change shows in the app and does
not change a started payment; CSV opens in Excel with correct amounts.

---

## Sprint 6 — Test deployment and end-to-end

- Render Blueprint (backend Docker, Postgres, Redis, portal), runbook, seeds.
- End-to-end on two phones: entry pays (Paystack test), ticket prints (PDF),
  exit validates, second scan "Already used", check at entry shows USED, an
  expired ticket is refused (validity set low on the test site).
- Operator guide (short, with screenshots).

**Checklist:** the end-to-end run recorded with screenshots; webhook URL set to
the test API; no live keys anywhere.

---

## Sprint 7 — Paystack Terminal (M960) — blocked

Starts only after Paystack answers the open questions (integration method,
debug device, app review, printing and scanning access).
