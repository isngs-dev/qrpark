# QR Parking — Build Rules

A standalone app to support parking operations at Garki International Market
during the festive season, until the full E-Parking system is ready. Entry
operators take payment and print a QR ticket; exit operators scan it once to
close it. It is deliberately small. Read `docs/01-flow.md` first; it is the
master reference for behaviour. `docs/02-scope.md` says what is in and out.

**Reference project (read-only):** `C:\Dev\eparking` is our full E-Parking
system. It already solves most of what this app needs (Paystack payments,
webhooks, verify, locks, QR tokens, Android POS app, Admin Portal, Render
deploy). `docs/06-reuse-from-eparking.md` lists what to take from it.
- **Never modify anything in `C:\Dev\eparking`.** Read it, copy from it, adapt.
- This app does **not** depend on eparking at run time or build time: copied
  code is copied, not imported or linked. No shared database, no shared
  backend.
- When you copy a file or a pattern, say so in your report (source path) so it
  can be reviewed against the original.

---

## Living documents — read these before writing code

- **`docs/schema.md`** — every table, column, type and constraint. Created in
  Sprint 1. Updated in the same commit as any migration.
- **`docs/api.md`** — every endpoint, with request and response shapes. Created
  in Sprint 2. Updated in the same commit as any endpoint change.

Before implementing anything that touches the database or an endpoint, read
these two files first. If a sprint needs something not in them, add it in the
same commit. If they disagree with the code, say so rather than working around
it.

---

## How we work

- **One sprint at a time.** Sprints are in `docs/04-sprints.md`. Do not start
  work belonging to a later sprint.
- **Summarize before building.** At the start of a sprint, say in plain language
  what you understand it to require and what you plan to do. Wait for
  confirmation before writing code.
- **Ask before changing a locked decision.** If something appears to contradict
  the rules below, stop and ask.
- **No unrequested scope.** No features, endpoints, screens, abstractions or
  dependencies the current sprint does not call for.
- **Tests before screens** for anything touching money, time or access control.
- **Prove tests guard something:** for each key rule, show the test fails when
  the rule is removed, then restore it.
- **Report evidence, not summaries:** raw test output, file paths and lines,
  screenshots for screens. Never just "all tests pass".
- **Never run `git commit` or `git push`.** Stage only and stop. The user does
  all commits. Suggested commit messages carry **no Co-Authored-By line**.
- **Housekeeping:** when you build a new APK, delete the previous APK of the
  same kind and its `.sha256` in the same step.

---

## Locked decisions — do not deviate

### The ticket and its QR

- A ticket exists **only after Paystack has confirmed the payment** (webhook or
  verify call). A pending, failed, declined or abandoned payment never produces
  a ticket, a token or a printable QR.
- One payment, one ticket, one QR. Never a second QR for a ticket; a reprint
  prints the same QR.
- The QR contains **only an opaque random token** (at least 128 bits of
  randomness). Never a database id, a sequence, the Paystack reference, the
  amount or the name. A guessable token is a security defect.
- The ticket also has a short human **ticket number** for search and support.
  It is not a credential and is never accepted in place of the QR.
- **Exit validation is single use.** The first successful exit scan marks the
  ticket USED, atomically, in one conditional database update (used only if
  not already used and not expired). Two exit devices scanning the same ticket
  at the same moment: exactly one gets "Valid — allow exit", the other gets
  "Already used". A read-then-write check is not enough.
- **Entry "Check ticket" is read-only.** It shows the ticket's status and never
  changes it.
- **Validity:** a ticket is valid until `valid_until`, set by the backend at
  issue time as payment time + the site's validity hours (a site setting,
  edited in the Admin Portal). The value is stored on the ticket; changing the
  setting never changes tickets already issued. After `valid_until` an unused
  ticket is EXPIRED and cannot exit.
- Every scan (check or exit) is recorded: ticket (if found), result, gate,
  operator, device, backend time.
- Scan results (exactly these, in plain words on screen):
  `VALID` (allow exit) · `ALREADY_USED` (show when, which gate, which operator)
  · `EXPIRED` (show valid-until) · `INVALID_QR` (not a token we could have
  issued) · `NOT_FOUND` (well-formed token, no ticket) ·
  `PAYMENT_NOT_COMPLETED` (reserved for a payment-first terminal flow; see open
  questions).
- **No connection, no exit approval.** If the backend cannot be reached, the
  exit screen says it cannot verify and never shows "Valid". There is no
  offline validation.

### Money

- **Paystack only. No cash.** Every ticket is backed by a payment Paystack
  confirmed.
- **All amounts are integers in kobo.** Never floating point, anywhere.
- **The backend sets every amount.** Price is a flat amount per vehicle
  category, set in the Admin Portal. No hourly billing, no duration, no
  discounts. The app displays what the backend returns and sends a category
  code, never a price.
- The payment stores a **snapshot of the price** at the time it was started.
  Changing a price never changes a payment already started.
- **Verify every webhook signature** before acting on it.
- **Webhook handling is idempotent**, keyed on our own payment reference.
- If no webhook arrives within ~20 seconds, call Paystack's verify endpoint.
  A background job re-checks anything left pending.
- **No double charge:** one operator cannot start a second payment while one is
  in progress (lock, with a database constraint behind it), and a repeated
  "Take payment" tap for the same entry attempt returns the same payment
  (idempotency key from the app, unique in the database).
- Refunds are done in the Paystack dashboard. This app does not issue refunds.

### Time

- All timestamps (payment, issue, valid-until, scans) are set by the backend
  in UTC, stored with time zone, displayed in Africa/Lagos.
- A device never supplies a time that affects validity.

### Access

- Roles: `ADMIN`, `ENTRY_OPERATOR`, `EXIT_OPERATOR`. Each operator is assigned
  to one gate.
- Entry operators: take payments, issue and reprint tickets, check tickets.
- Exit operators: validate (close) tickets, check tickets.
- Admin Portal: ADMIN only.
- JWT access + refresh tokens, Argon2 password hashing, NestJS guards, 12+
  character passwords.

### Devices

- **One Android app** with Entry and Exit modes; the mode comes from the
  operator's role. Testing runs on ordinary Android phones (Android 10+); the
  final device is the **Paystack Terminal (Morefun M960)**.
- Payment, printing and scanning sit behind interfaces with adapters:
  - Payment: Paystack checkout (now). Paystack Terminal (later, after
    Paystack's answers). Both are confirmed only by the backend.
  - Printer: Android printing (now, PDF preview on phones). Terminal printing
    later.
  - Scanner: camera (CameraX + zxing) and keyboard-wedge scanners. A scan only
    fills the field; it never validates by itself. Staff tap to validate.
- Adapters are chosen by capability at run time. **No device model names,
  serial numbers or device lists in code.**

### Deployment

- Backend, database and Admin Portal are cloud only. One codebase.
- Operational settings (categories, prices, validity hours, receipt details,
  gates, users) live in the **database** and are edited in the Admin Portal.
  Environment variables are for infrastructure and secrets only.
- Test environment on Render (as eparking). Production host is an open
  question.
- Paystack **test keys only** until go-live is approved. Never commit a key.

---

## Stack

Same as eparking, so code and patterns can be reused:

- Backend: Node.js + NestJS (TypeScript), Prisma
- Database: PostgreSQL
- Locks and jobs: Redis + BullMQ
- Admin Portal: Next.js (React) + Tailwind
- Android app: native Kotlin, XML views, Material 3, minSdk 29
- Payments: Paystack
- Packaging: Docker; CI: GitHub Actions

Do not add a dependency without saying why the standard library or an existing
dependency will not do.

---

## Ticket and payment states

```
payment: PENDING · SUCCESS · FAILED · ABANDONED
ticket:  ACTIVE · USED · (EXPIRED is derived: not used and now > valid_until)
```

---

## Open questions — do not invent answers

If a sprint needs one of these, stop and ask:

- Paystack Terminal integration on the M960 (custom app via intent vs push
  payment request), debug-device commissioning, and app review timeline
- Whether our app can print and scan on the M960, or only through Paystack's
  receipt
- Whether the QR may be printed on Paystack's own receipt (that would need a
  token created before confirmation, which conflicts with "ticket only after
  confirmation")
- Production hosting (the scope document suggests AWS; test runs on Render)
- Garki's real categories and prices (seed TEST VALUES until then)
- Default validity hours (12 assumed for testing)
- Whether the customer name is required (scope says optional)
- Receipt branding (logos, organisation name, contact line)
