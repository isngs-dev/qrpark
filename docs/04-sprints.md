# 04 — Sprints

One sprint at a time. Each sprint ends with its checklist passing, evidence
reported (raw test output, screenshots), files staged, and the user
committing. Do not start the next sprint until told.

**2026-11-07: the flow changed** (entry creates an UNPAID ticket, a payment
booth takes cash or card, the exit requires PAID; see `CLAUDE.md` and
`01-flow.md`). Sprints 0–3 are done and stay below as history; where their
text describes the old flow, Sprint R supersedes it. Sprint R comes next,
then Sprint 4.

---

## Sprint 0 — Repository and skeleton — DONE (2042c99)

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

## Sprint 1 — Data model, auth, configuration — DONE (bc36015)

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

## Sprint 2 — Payments and ticket issue — DONE (bfed3b0; delayed checks 85394d3)

> Superseded by Sprint R: the ticket is no longer created on payment, and
> `validity_hours` is removed.

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

## Sprint 3 — Validation and check — DONE (65aaae2)

> Changed by Sprint R: the exit update also requires PAID, the results gain
> PAYMENT_REQUIRED, and check is open to all three operator jobs.

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

## Sprint R — Rework for the new flow (migration 0003 + backend)

The flow of 2026-11-07, in the database and the API. One commit-able unit
(see the plan in the rework report); no Android or portal work.

- **Migration 0003** (0001 and 0002 are never edited):
  - The ticket stops depending on a payment; the payment points at its ticket.
    Drop the `ticket_requires_success_payment` trigger and `ticket.payment_id`.
  - Ticket: payment status (UNPAID/PAID) and validation status
    (NOT_VALIDATED/VALIDATED) as separate columns; fee snapshot; category;
    entry device; ticket idempotency key (unique); `valid_until` set by the
    database at creation to the start of the next Lagos day. Drop
    `customer_name` and `validity_hours` (ticket and settings).
  - Payment: method CASH/CARD, `ticket_id`, booth and device; amount equal to
    the ticket's fee snapshot.
  - Guards in the database: at most one SUCCESS and one PENDING payment per
    ticket; one PENDING per operator (kept); idempotency keys unique; a ticket
    becomes PAID only by pointing at a SUCCESS payment of its own; VALIDATED
    requires PAID.
  - Location kind BOOTH; role PAYMENT_OPERATOR; scan result PAYMENT_REQUIRED
    (the result/kind rule updated); `app_user.deleted_at` (soft delete) with a
    username unique only among non-deleted accounts.
- **Endpoints:** create ticket (ENTRY); check (all three operator jobs, new
  response); lookup by trailing characters; reprint (ENTRY); cash confirm
  (PAYMENT); start a card payment against a ticket (PAYMENT); get payment;
  validate (EXIT, requires PAID); admin: booths as locations, delete account,
  settings without validity hours. `docs/schema.md` and `docs/api.md` updated
  in the same commit.
- **Seeds:** gates ENTRY_1, EXIT_1, BOOTH_1, BOOTH_2; one test operator per
  job (passwords printed once).
- Tests first; every changed rule re-proven with fail-when-removed: the exit
  update (now with PAID) under concurrency; PAID only through a SUCCESS payment
  of its own; one SUCCESS per ticket; cash double tap; expiry at the end of
  the Lagos day; role and location rules; soft delete.

**Checklist:** 0003 applies on an empty database and `migrate diff` is clean;
the full suite passes; every changed rule fails when removed; schema.md and
api.md match the code.

---

## Sprint 4 — Android app (three modes, in three parts) — 4a DONE (bf82334), 4b DONE (02f8ed4; fix round 537422e), 4c staged

One app; the mode comes from the account's job. Each part has its own review
and commit. Tested on the Android emulator (AVD Medium_Phone); the debug build
talks to `http://10.0.2.2:3000` (cleartext in debug only; release is HTTPS
only).

**4a — Sign-in and Entry mode**
- Login, session, refresh; tokens in encrypted storage; mode from the role;
  location shown. Project setup: release rules from eparking's build-logic
  (version, build number and commit in the APK name; HTTPS-only release).
- Entry: category list from the backend, New ticket (idempotency key per
  attempt, reused on retry and restart), ticket screen with the QR and the
  GSD/AIC header, print (Android print), recent list, lookup by number,
  reprint, check.

**4b — Booth mode**
- Scan field (camera and keyboard-wedge; a scan only fills the field), Find by
  number, Check, then the exact booth flow of `01-flow.md` §2: Take payment ₦N
  → Cash ("Confirm ₦N cash received", one tap, double tap safe) or Card
  (Paystack checkout, wait for the backend's SUCCESS; FAILED / ABANDONED /
  "Not confirmed yet" shown plainly; 409 resumes the pending payment).

**4c — Exit mode, check, release build**

Done in 4c: Exit mode (ExitActivity, ExitRules.kt); Check in every mode with
the scanned text masked in every scan field; the signed release build
(`releaseApk`, signing from the user's own `~/.gradle/gradle.properties`,
proven with a throwaway key) and the signing steps in `android/BUILDING.md`;
a CI job for the Android JVM tests.

- Exit: focused field, wedge and camera, Validate (one request at a time),
  the result screens of `01-flow.md` §3 including PAYMENT_REQUIRED and
  "Already used by you", grey "Cannot verify" on no connection or 5xx, Next.
- Check ticket in every mode. Release build configuration and the signing
  steps for the user.

Throughout: adapters for payment, printer and scanner, chosen by capability;
no device names in code; no price logic or amount arithmetic in the app;
tokens and scanned text never logged.

**Checklist (each part):** unit tests for its state handling with
fail-when-removed for the money and scan rules; screenshots of every screen
(and in 4c every exit result) from the emulator; a scan never acts by itself;
no price logic in the app.

---

## Sprint 5 — Admin Portal

- Login; vehicle types & prices; settings (site name, organisation name and
  contact line, payment window; Paystack mode read-only); locations (entry
  gates, booths, exit gates); operators (create with one job and one location,
  deactivate, **delete** (soft), reset password).
- Transactions (search, filters, detail with payments and scans);
  **Incomplete sessions** (tickets never validated at exit, per day, entry
  gate, booth, operator); **Finance / Revenue** (cash and card separately and
  in total, per day, booth, operator); dashboard; CSV export.
- Naira display from kobo; Lagos times. No refunds, reversals or corrections.

**Checklist:** screenshots of each page; a price change shows in the app and
does not change a ticket already issued; recorded cash per booth and operator
matches the database; CSV opens in Excel with correct amounts.

---

## Sprint 6 — Test deployment and end-to-end

- Render Blueprint (backend Docker, Postgres, Redis, portal), runbook, seeds.
- End-to-end, entry → booth → exit: entry issues a ticket (prints as PDF); exit
  refuses it while UNPAID ("Payment required"); the booth takes cash for one
  ticket and card (Paystack test) for another; exit validates both; a second
  scan says "Already used"; check shows the statuses at each step; a ticket from
  an earlier day (inserted by raw SQL with an earlier `issued_at`, the only way
  one can exist: the API never takes a time) is refused as EXPIRED at the booth
  and at exit; the Finance
  page shows the cash and card amounts; Incomplete sessions lists a ticket that
  never reached the exit.
- Operator guide (short, with screenshots), one page per job.

**Checklist:** the end-to-end run recorded with screenshots; webhook URL set to
the test API; no live keys anywhere.

---

## Sprint 7 — Paystack Terminal (M960) — blocked

Starts only after Paystack answers the open questions (integration method,
debug device, app review, printing and scanning access).
