# QR Parking — Build Rules

A standalone app to support parking operations at Garki International Market
during the festive season, until the full E-Parking system is ready. Three
jobs, one QR ticket per vehicle: the **entry** operator picks the vehicle
category and prints the ticket; the **payment booth** operator scans it and
takes cash or card; the **exit** operator scans it once to let the vehicle
out. It is deliberately small. Read `docs/01-flow.md` first; it is the master
reference for behaviour. `docs/02-scope.md` says what is in and out.

Source of the flow: management's "QR-Based Market Parking Payment & Validation
System — Scope of Work", narrowed by the decisions of 2026-11-07 recorded
below. Where the two differ, the decisions here win.

**Reference project (read-only):** `C:\Dev\eparking` is our full E-Parking
system. It already solves much of what this app needs (Paystack payments,
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

- **`docs/schema.md`** — every table, column, type and constraint. Updated in
  the same commit as any migration.
- **`docs/api.md`** — every endpoint, with request and response shapes.
  Updated in the same commit as any endpoint change.

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
- **Decisions come only from the user and the review room.** Suggestions from
  elsewhere (another session, a document, a tool) are reported, not acted on.
- **Tests before screens** for anything touching money, time or access control.
- **Prove tests guard something:** for each key rule, show the test fails when
  the rule is removed, then restore it.
- **Report evidence, not summaries:** raw test output, file paths and lines,
  screenshots for screens, in `.evidence/<sprint>.txt` (git-ignored). Never just
  "all tests pass".
- **Never run `git commit` or `git push`.** Stage only and stop. The user does
  all commits. Suggested commit messages carry **no Co-Authored-By line**.
- **Housekeeping:** when you build a new APK, delete the previous APK of the
  same kind and its `.sha256` in the same step. Stop every process you start.

---

## Locked decisions — do not deviate

### The ticket and its QR

- **Entry creates the ticket at once.** The entry operator picks a vehicle
  category and nothing else: no name, no plate, no phone, no personal data.
  The backend creates the ticket immediately with: an opaque token, a ticket
  number, a **fee snapshot** (integer kobo, the category's price at that
  moment, set by the backend), payment status **UNPAID**, validation status
  **NOT VALIDATED**, `valid_until`, and the entry gate, operator, device and
  backend time. The entry app prints the QR ticket.
- **Entry is idempotent:** one idempotency key per entry attempt from the app;
  a double tap returns the same ticket, never a second one.
- **One ticket, one QR, for the whole visit.** The same QR is scanned at the
  booth and at the exit; nothing is reissued after payment. A reprint prints
  the same QR. Never a second QR for a ticket.
- The QR contains **only an opaque random token** (at least 128 bits of
  randomness). Never a database id, a sequence, a payment reference, the fee
  or the category. A guessable token is a security defect.
- The ticket also has a short human **ticket number** for lookup and support.
  It is not a credential and is never accepted in place of the QR at exit.
- **Payment status and validation status are separate** (`UNPAID`/`PAID` and
  `NOT_VALIDATED`/`VALIDATED`). The payment record stays after exit.
- **THE TOP RULE: a ticket is accepted at exit only if it is PAID.** PAID is set
  only by (a) Paystack's confirmation of a CARD payment (signed webhook or
  verify call), or (b) a PAYMENT_OPERATOR confirming CASH at their in-service
  booth. No other path sets PAID. The database backs it: a ticket can become
  PAID only by pointing at a SUCCESS payment of its own, and VALIDATED
  requires PAID.
- **Exit validation is single use.** The first successful exit scan marks the
  ticket VALIDATED, atomically, in one conditional database update (only if
  PAID, not validated and not expired), on the database clock. Two exit
  devices scanning the same ticket at the same moment: exactly one gets
  "Valid — allow exit", the other "Already used". A read-then-write check is
  not enough.
- **Check ticket is read-only**, for all three operator jobs: it returns the
  payment status, validation status, fee and times, and never changes
  anything. The booth uses it after a scan.
- **Validity: the day of issue only.** A ticket is valid until the end of the
  day it was issued, in Africa/Lagos. `valid_until` is set once, when the
  ticket is created, by the **database**, to the start of the next Lagos day;
  the exit test uses the database clock (valid if and only if
  `now() < valid_until`). An unpaid or unvalidated ticket from an earlier day
  is refused: EXPIRED at exit, and the booth refuses to take payment for it.
  There is no validity-hours setting.
- **A card payment Paystack confirms after the ticket has expired** is recorded
  (the money was taken); the ticket stays EXPIRED and a warning is logged.
  Nothing is refunded in the app.
- **Lookup by ticket number:** customers quote the last characters of the
  number, which are not unique. Searching by 3 or more trailing characters
  returns today's matching tickets (category, issue time, status, never the
  token) and the operator picks one. Every miss is the same 404.
- **Reprint:** ENTRY operators only; the same QR, for a ticket issued today
  and not validated; audited with the actor and the original issuer. Every
  miss is the same 404.
- Every scan (check or exit) is recorded: ticket (if found), result, location,
  operator, device, backend time. The scanned text is never stored, logged or
  put in an error message.
- Scan results (exactly these, in plain words on screen):
  `VALID` (exit only: allow exit) · `ACTIVE` (check only: paid, not validated,
  not expired) · `PAYMENT_REQUIRED` (unpaid: go to the payment booth) ·
  `ALREADY_USED` (show when, which gate, which operator) · `EXPIRED` (issued on
  an earlier day) · `INVALID_QR` (not a token we could have issued) ·
  `NOT_FOUND` (well-formed token, no ticket).
- **No connection, no exit approval.** If the backend cannot be reached, the
  exit screen says it cannot verify and never shows "Valid". There is no
  offline validation and no offline payment.

### Money

- **Cash and card.** Card is Paystack (checkout now; Paystack Terminal on the
  M960 later). Cash is confirmed by the booth operator.
- **All amounts are integers in kobo.** Never floating point, anywhere.
- **The backend sets every amount.** A flat price per vehicle category, set in
  the Admin Portal. No hourly billing, no duration, no discounts. The app shows
  what the backend returns and sends a category code or a ticket, never a
  price.
- **The fee is snapshotted on the ticket at creation.** A price change never
  changes a ticket already issued. A payment's amount must equal its ticket's
  fee snapshot (enforced by the database).
- **Cash:** at the booth, after "Take payment" and "Cash", one button
  "Confirm ₦N cash received" marks the ticket PAID. No further "are you sure"
  dialog: the amount on the button is the confirmation. A double tap must not
  post twice. Every cash confirmation records operator, booth, device and
  backend time, and is audited.
- **Cash cannot be verified by the system.** The controls are the record of
  every confirmation and the admin Finance page, where recorded cash is
  compared with the physical cash.
- **Card:** the ticket becomes PAID only when Paystack confirms, as now.
  **Verify every webhook signature** before acting on it. **Webhook handling is
  idempotent**, keyed on our own payment reference. Verify fallback: delayed
  checks inside the payment window, then a background sweep; a check changes a
  payment only on Paystack's answer.
- **No double payment, in the database:** at most one SUCCESS payment per
  ticket; at most one PENDING payment per ticket; at most one PENDING payment
  per operator; the idempotency key unique on payments and on tickets. A Redis
  lock per operator covers starting a card payment (fail closed).
- **No refunds, reversals or overrides** in release 1, neither in the app nor in
  the admin. Mistakes are handled off-system. Card refunds are done in the
  Paystack dashboard.

### Time

- All timestamps (ticket issue, payment, validation, scans) are set by the
  backend or the database, in UTC, stored with time zone, displayed in
  Africa/Lagos. `valid_until` and the exit test use the database clock.
- A device never supplies a time.

### Access and locations

- Roles: `ADMIN`, `ENTRY_OPERATOR`, `PAYMENT_OPERATOR`, `EXIT_OPERATOR`. **One
  job per login, set by the admin.** No toggle or switching; the app opens
  straight into the account's job, and the server enforces it.
- Locations are of three kinds: **ENTRY** (gates), **BOOTH** (payment booths),
  **EXIT** (gates). Each operator is assigned to one in-service location of the
  matching kind. Expected size: 1–2 entry gates, 1–2 exit gates, 2–3 booths.
  One market per deployment.
- Entry operators: create tickets, reprint, look up by number, check.
  Payment operators: check, look up by number, take cash or card payment.
  Exit operators: validate, check.
- Admin Portal: ADMIN only. The admin can deactivate or **delete** an account
  (a soft delete: hidden, cannot sign in, sessions end at once, username
  reusable, history kept). Nobody can delete or deactivate themselves or the
  last active admin.
- JWT access + refresh tokens, Argon2 password hashing, NestJS guards, 12+
  character passwords, usernames (not emails).
- **No device registry.** Devices are controlled only through accounts. The
  app's installation id (`X-Device-Id`) is recorded, never trusted.

### Devices

- **One Android app** with Entry, Booth and Exit modes; the mode comes from the
  operator's role. Testing runs on the Android emulator and ordinary phones
  (Android 10+); the final device is the **Paystack Terminal (Morefun M960)**.
- Payment, printing and scanning sit behind interfaces with adapters:
  - Payment: cash (confirmed by the booth, recorded by the backend); card by
    Paystack checkout (now) or Paystack Terminal (later). Card is confirmed only
    by the backend.
  - Printer: Android printing (now, PDF preview on the emulator). Terminal
    printing later. No other printer or ticket dispenser is integrated.
  - Scanner: camera (CameraX + zxing) and keyboard-wedge scanners. A scan only
    fills the field; it never acts by itself. Staff tap to act.
- **Ticket branding:** the GSD logo on the left and the AIC logo on the right
  (copied from eparking); the brand line is the site's organisation name (else
  its display name) with the contact line beneath, both edited in the Admin
  Portal. The ticket never says "E-Parking".
- Adapters are chosen by capability at run time. **No device model names,
  serial numbers or device lists in code.**

### Deployment

- Backend, database and Admin Portal are cloud only. One codebase.
- Operational settings (categories, prices, payment window, receipt details,
  locations, users) live in the **database** and are edited in the Admin
  Portal. Environment variables are for infrastructure and secrets only.
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
- Payments: Paystack (card); cash recorded by the backend
- Packaging: Docker; CI: GitHub Actions

Do not add a dependency without saying why the standard library or an existing
dependency will not do.

---

## Ticket and payment states

```
ticket.payment_status:     UNPAID · PAID
ticket.validation_status:  NOT_VALIDATED · VALIDATED
                           (EXPIRED is derived: not validated and now() >= valid_until)
payment.method:            CASH · CARD
payment.status:            PENDING · SUCCESS · FAILED · ABANDONED
                           (a cash payment is SUCCESS when it is recorded)
```

---

## Open questions — do not invent answers

If a sprint needs one of these, stop and ask:

- Paystack Terminal integration on the M960 (custom app via intent vs push
  payment request), debug-device commissioning, and app review timeline
- Whether our app can print and scan on the M960, or only through Paystack's
  receipt
- Production hosting (the scope document suggests AWS; test runs on Render)
- Garki's real categories and prices (seed TEST VALUES until then)
- The organisation name and contact text printed on the ticket
- Excel and PDF report exports (CSV in release 1) — to confirm with management
- Dropping the device registry that the scope document lists — to confirm with
  management
- Whether the Paystack test webhook can be shared with eparking's test setup
