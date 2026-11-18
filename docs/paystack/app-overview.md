# QR Parking — application overview for Paystack review

## 1. What the app is and who uses it

**QR Parking** is the parking ticket and payment system for a market car park
(Garki International Market, Abuja). Each vehicle receives one paper ticket
with a QR code when it enters; the parking fee is paid at a payment booth, in
cash or by card through Paystack; the ticket is checked once at the exit.

It has three parts:

- an **Android app** used only by the car park's staff (customers never install
  or use it, never sign in, and give no name, phone number or plate number);
- a **backend** (server) that holds every rule, amount and record;
- a web **Admin Portal** for the car park's administrators.

Fees are a flat price per vehicle type, set by an administrator. There are no
hourly charges, discounts or customer accounts.

## 2. The three operator jobs and the ticket lifecycle

Each staff account has exactly one job and one location, set by an
administrator; the app opens straight into that job.

| Job | Where | What the operator does |
|---|---|---|
| **Entry** | an entry gate | Picks the vehicle type, taps **New ticket**, prints the ticket |
| **Payment booth** | a payment booth | Scans the ticket, then takes **cash** or **card** (Paystack) |
| **Exit** | an exit gate | Scans the ticket once to let the vehicle out |

One ticket and one QR code serve the whole visit:

```
  ENTRY                    PAYMENT BOOTH                         EXIT
  ticket created  ──────►  cash confirmed by the operator  ──►  validated once
  UNPAID                   or card confirmed by Paystack         (single use)
                           ► PAID
```

- A ticket is accepted at the exit **only when it is paid**, and only once:
  the first valid exit scan closes it; any later scan says "Already used".
- A ticket is valid on the day it was issued only (Lagos time).
- Any staff member can **check** a ticket (read-only) by scanning it.
- Without a connection to the server the exit screen says it cannot verify
  the ticket; there is no offline approval and no offline payment.

## 3. How card payment works today

Card payments use **Paystack's standard checkout page, opened inside the app**,
on the booth operator's Android device. The customer enters their card
details on Paystack's page.

**Step by step**

1. The booth operator scans the ticket and taps **Card**. The app sends only
   the ticket and a one-time **idempotency key** for this attempt. It never
   sends an amount.
2. The **server** creates the payment record and calls Paystack's
   **Initialize Transaction** API with our **secret key**. The secret key exists
   only on the server: it is never sent to, stored on or compiled into the app.
   The server sends:
   - `amount`: the ticket's fee in **kobo** (an integer, never a decimal),
     fixed when the ticket was created;
   - `currency`: `NGN`;
   - `reference`: our own payment reference, `QRP_` followed by 24 random
     hexadecimal characters, unique per payment;
   - `email`: one fixed address on our own domain for all walk-in customers
     (Paystack requires an e-mail; we hold no customer details).
3. The server returns Paystack's checkout address to the app, which opens it in
   an in-app sheet. The sheet only displays the checkout; **it decides
   nothing**. Closing it, or anything the device reports, is never treated as
   a successful payment.
4. The payment becomes successful **only when the server receives Paystack's
   confirmation**, in either of two ways:
   - a **webhook** from Paystack: the server checks the `x-paystack-signature`
     header (HMAC-SHA512 of the raw request body with the secret key, compared
     in constant time) **before** reading anything else. An unsigned or wrongly
     signed request is refused (HTTP 401) and changes nothing;
   - a **Verify Transaction** call from the server
     (`GET /transaction/verify/{reference}`, with the secret key).
5. Before accepting a success, the server checks that Paystack's amount and
   currency are exactly the ticket's fee in kobo and `NGN`. Any mismatch is not
   accepted and is logged.
6. The booth app follows the payment's status from the server and shows
   **Paid** when the server has recorded it.

**Delayed checks (when a webhook is late or missed)**: after starting a
payment, the server verifies it itself at 20, 45, 90, 150 and 240 seconds
(within the payment window set by the administrator), and a background sweep
every 2 minutes checks any payment still pending. A payment that Paystack says
was not completed by the end of the window is marked abandoned. A payment that
ended as abandoned or failed is checked again for 30 minutes, so a customer who
did pay late is never lost. A check changes a payment only on Paystack's answer.

**Cancelling**: if a customer gives up, the operator may cancel the card
attempt 60 seconds after it started. The server asks Paystack first: if the
customer did pay, the payment is kept as successful and nothing is cancelled.

**Safeguards against double charging**, enforced by the database:

- at most **one successful payment per ticket**;
- at most **one pending payment per ticket** and **one pending payment per
  operator** at a time (plus a lock per operator while a card payment starts;
  if the lock cannot be taken, the payment is refused rather than risked);
- the **idempotency key is unique** per payment attempt, so a repeated tap
  returns the same payment instead of creating a second one;
- webhook handling is **idempotent**, keyed on our payment reference: a
  repeated webhook changes nothing;
- if a card payment is confirmed for a ticket that was already paid (for
  example in cash), it is recorded as a duplicate for a refund in the Paystack
  dashboard; it is never counted as revenue twice.

No refunds, reversals or payment corrections exist in the app or the portal;
card refunds are made in the Paystack dashboard.

The server refuses to start with a live secret key until going live is
approved; only test keys are in use today.

## 4. Card data and security

**Card data**

- Card details are typed **only on Paystack's page**. The app and the server
  never receive, see or store a full card number, CVV, PIN or OTP.
- For each card payment the server keeps Paystack's own verified transaction
  record as Paystack returns it, for reconciliation, **with the reusable
  authorization code removed** (we never charge a card again). That record
  contains what Paystack itself reports about the card, such as the masked
  card number (first six and last four digits), expiry month and year, card
  type and issuing bank.
- No customer personal data is collected anywhere.

**The in-app checkout view**

- It opens only `https://` pages, and its first page must be Paystack's
  checkout; plain `http` is refused on every page and frame.
- A certificate error is never passed: the page is refused.
- There is no JavaScript bridge from the page into the app; file and content
  access are off; form data is not saved; on closing, its cache, cookies, web
  storage and form data are cleared.
- Bank 3-D Secure pages load normally; links into other apps are refused.

**The app**

- **HTTPS only**: the app's network rules allow no unencrypted traffic, and a
  release build cannot be made with a non-https server address.
- The session tokens on the device are kept **encrypted** with an AES-256 key
  held in the Android Keystore; app backup is turned off.
- Staff sign in with a username and password (at least 12 characters); every
  role is enforced by the server, not by the app.

**The QR code**

- The QR holds **only an opaque random token** (256 random bits). It contains
  no ticket number, amount, vehicle type, payment reference or database
  identifier, and cannot be guessed. The short ticket number printed on the
  ticket is for support only and is never accepted at the exit.

**The server**

- Reachable only over HTTPS; the database and cache are not reachable from
  the internet.
- Passwords are stored as Argon2id hashes. Access tokens last 15 minutes and
  refresh tokens 7 days; a session ends at once when the account is
  deactivated, deleted, moved to another job or location, has its password
  reset, or signs out.
- **Sign-in lockout**: failed sign-ins are counted for 15 minutes — 5 for one
  username from one address, 20 for one username, 30 from one address — after
  which every attempt is refused, even with the right password, until the
  count expires or an administrator resets the account's password. Each
  lockout is written to the audit log.
- **Logs never contain** a ticket token, scanned text, password, key, checkout
  address, access code, authorization code or Paystack's payload; an automated
  test checks every log call for this.
- Every cash confirmation, cancellation, reprint, price change and account
  change is written to an audit log that cannot be edited or deleted.
- All times are set by the server or the database, never by a device.

## 5. Roles and the Admin Portal

| Role | Can |
|---|---|
| Entry operator | Create tickets, reprint today's tickets, look a ticket up by number, check a ticket |
| Payment operator | Check a ticket, look a ticket up by number, take cash or card payment |
| Exit operator | Validate a ticket at the exit, check a ticket |
| Administrator | The Admin Portal only |

The **Admin Portal** (web, administrators only) is used to:

- set vehicle types and their prices (a price change never affects a ticket
  already issued);
- manage entry gates, payment booths and exit gates;
- create, deactivate and delete staff accounts and set their passwords;
- edit the text printed on the ticket and the card payment window;
- view reports and the audit log.

## 6. Reporting and exports

- **Dashboard**: one day at a glance — tickets issued, paid, unpaid,
  validated, still in progress, and revenue in cash and card.
- **Transactions**: every ticket with its payments and scans, searchable and
  filterable; each payment shows our reference, so it can be found in the
  Paystack dashboard.
- **Finance**: revenue in cash and card, by day, hour, vehicle type, booth and
  operator, compared with the previous period; recorded cash per booth and per
  operator for reconciliation with the physical cash; duplicate and cancelled
  card payments listed apart and never counted as revenue.
- **Incomplete sessions**: tickets never validated at the exit.
- **Audit log**: who did what, and when.
- **CSV exports** of Transactions, Incomplete sessions, Finance and the Audit
  log, up to 92 days per file and at most 1,048,575 rows (the most Excel
  opens), streamed and opened directly by Excel. All amounts come from the
  server in kobo and are shown in naira.

## 7. Built and tested versus planned

| Item | Status |
|---|---|
| Ticket at entry, printed through Android printing | **Built and tested** (automated tests; Android emulator) |
| Check and exit validation, single use, offline refusal | **Built and tested** (automated tests; Android emulator) |
| Cash payment confirmed by the booth operator | **Built and tested** (automated tests; Android emulator) |
| Card payment: server-side initialisation, in-app Paystack checkout, signed webhook, verify, delayed checks, cancel, idempotency | **Built and tested** against Paystack's test mode (automated tests; Android emulator with Paystack test checkout) |
| QR scanning with the phone camera; typing a ticket in | **Built and tested** (automated tests; Android emulator) |
| Admin Portal, reports, CSV exports, audit log | **Built and tested** (automated tests; browser) |
| Sign-in lockout, encrypted storage, https-only rules | **Built and tested** (automated tests) |
| Full run on Android phones against the hosted test environment | **Built and tested**: the full journey (entry, cash and card payment, exit, expiry, reports, sign-in lockout) was run on an Android phone against the hosted test environment with Paystack in test mode. |
| **Paystack Terminal (Morefun M960)** card-reader payment flow | **Planned**: not built; **not yet tested on a terminal** |
| **Printing** the ticket on the terminal's printer | **Planned**: not built; **not yet tested on a terminal** |
| **Scanning** tickets with the terminal's scanner | **Planned**: not built; **not yet tested on a terminal** |
| Hardware barcode scanners (keyboard-wedge) | Supported by design (a scan only fills the ticket field); **not yet tested with a hardware scanner** |
| Live Paystack keys | **Planned**: only after approval; the server refuses live keys until then |
