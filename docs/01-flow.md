# 01 — How the system behaves

Master reference. If code disagrees with this file, the code is wrong or this
file is stale: say which.

Source: management's Scope of Work ("QR-Based Market Parking Payment &
Validation System") and the decisions of 2026-11-07 in `CLAUDE.md`, which win
where the two differ.

## Actors

- **Entry operator** at an entry gate, with the Android app in Entry mode.
- **Payment operator** at a payment booth, with the app in Booth mode.
- **Exit operator** at an exit gate, with the app in Exit mode.
- **Customer**, with a vehicle. Never logs in; gives no name, plate or phone;
  holds a paper ticket from entry to exit.
- **Admin**, in the web Admin Portal.
- **Paystack**, the only source of truth that a card payment succeeded.

Each operator account has one job (entry, payment or exit) and one location of
the matching kind, set by the admin. The app opens straight into that job;
there is no switching.

The same QR is used for the whole visit:

```
Entry: ticket created, UNPAID  ->  Booth: paid (cash or card), PAID  ->  Exit: VALIDATED
```

## 1. Entry: issue the ticket

1. Operator signs in. The app opens in Entry mode and shows the operator's
   entry gate.
2. Operator taps **New ticket** and picks the **vehicle category** from the list
   (the list and its prices come from the backend). Nothing else is asked.
3. The app sends the category code and an idempotency key for this attempt.
   The backend creates the ticket at once:
   - an opaque random **token** (the QR) and a short **ticket number**,
   - the **fee snapshot**: the category's price now, integer kobo,
   - payment status **UNPAID**, validation status **NOT VALIDATED**,
   - `valid_until` = the start of the next day in Africa/Lagos, set by the
     database,
   - the entry gate, operator, device and backend time.
   A repeated tap for the same attempt returns the same ticket.
4. The app shows the ticket and **prints** it (Android print).
5. The operator hands the ticket to the customer and sends them on to the
   payment booth.

### The ticket (printed and on screen)

- Header: the GSD logo on the left, the AIC logo on the right; between them the
  site's organisation name (else its display name) with the contact line
  beneath (both from the Admin Portal settings). Never "E-Parking".
- **QR** (opaque token only)
- Vehicle type · Fee (₦, from the snapshot)
- Date and time issued (Africa/Lagos) · "Valid today only"
- Ticket number · Entry gate
- A line: "Pay at the payment booth. Show this ticket at the exit."

**Reprint**: entry operators can reprint a ticket from their recent list or
after a lookup by number (§4). Only a ticket issued today and not yet
validated; the same QR; audited (who reprinted, who issued it).

## 2. Payment booth: take payment

1. Operator signs in. The app opens in Booth mode and shows the booth.
2. The scan field is focused. The operator scans the ticket with the built-in
   scanner, or taps **Scan with camera**. The scan only fills the field. If the
   QR cannot be read, the operator taps **Find by number** (§4) and picks the
   ticket.
3. Operator taps **Check**. The backend reads the ticket (read-only) and the
   screen shows the ticket number, vehicle type, fee and issue time, and one of:
   - **Paid** (with method and time): nothing more to do.
   - **Already used**: the ticket was validated at exit.
   - **Expired** (issued on an earlier day): no payment is taken.
   - **Unpaid**: one button, **Take payment ₦N** (N is the backend's fee).
4. Operator taps **Take payment ₦N**. Two buttons: **Cash** and **Card**. No
   other pop-ups.
   - **Cash**: one button, **Confirm ₦N cash received**. One tap marks the
     ticket PAID; the screen shows **Paid**. There is no further "are you sure"
     dialog: the amount on the button is the confirmation. A double tap does not
     post twice. The confirmation records operator, booth, device and backend
     time, and is audited.
   - **Card**: the Paystack checkout opens inside the app, in a sheet the
     operator can close at any time; the sheet decides nothing. The app waits
     behind it ("Waiting for Paystack to confirm…") and takes the sheet down
     when the payment ends; closing the checkout, or any message from the
     device, is never success. The ticket becomes PAID only when Paystack
     confirms (signed webhook, or a verify call). FAILED or ABANDONED is said
     plainly and the operator can choose again; still pending says "Not
     confirmed yet" and keeps checking.
   - **Cancel payment** (Sprint 4b): if the customer gives up on the card, the
     operator taps **Cancel payment**, offered 60 seconds after the payment
     started (the backend refuses earlier and says when). The backend asks
     Paystack once: if the customer did pay, the ticket is PAID and nothing is
     cancelled; if not, the payment is ABANDONED. If Paystack cannot be
     reached, the screen warns that it cannot be confirmed, and the operator
     may confirm the cancel anyway. Then **Try card again** (a new attempt) or
     **Take cash**. Every cancel is recorded with the operator. A card payment
     that Paystack confirms after a cancel still makes the ticket PAID (or is
     recorded as a duplicate to refund, if cash was taken).
5. The customer keeps the same ticket and goes to the exit.

Rules at the booth:
- The amount is the ticket's fee snapshot. The app never sends or edits an
  amount.
- At most one successful payment per ticket, and at most one pending payment
  per ticket and per operator, enforced by the database.
- No payment is taken for an expired ticket, a paid ticket or a validated
  ticket.
- No refunds, reversals or corrections in the app. Mistakes are handled
  off-system; card refunds in the Paystack dashboard.

## 3. Exit: validate and close

1. Operator signs in; the app opens in Exit mode and shows the exit gate.
2. The field is focused. The operator scans the ticket with the built-in
   scanner, or taps **Scan with camera**. The scan only fills the field.
3. Operator taps **Validate**. The backend, in one conditional update on the
   database clock:
   - marks the ticket VALIDATED if it is PAID, not validated and not expired →
     `VALID`,
   - otherwise returns the reason without changing anything.
4. The result fills the screen in large type and colour:

| Ticket | Result | Screen | Operator does |
|---|---|---|---|
| PAID, not validated, issued today | `VALID` | Green: "Valid — allow exit", vehicle type, paid time | Lets the vehicle out |
| UNPAID, issued today | `PAYMENT_REQUIRED` | Red: "Payment required — go to the payment booth" | Sends the customer to the booth |
| Already validated | `ALREADY_USED` | Red: "Already used", when, which gate, which operator ("by you" when it was this operator) | Refuses |
| Not validated, issued an earlier day (paid or not) | `EXPIRED` | Red: "Expired", the issue date | Refuses |
| Well-formed token, no ticket | `NOT_FOUND` | Red: "Ticket not found" | Refuses |
| Not a token we issue | `INVALID_QR` | Red: "Not one of our tickets" | Refuses |
| No connection, or the backend cannot verify | — | Grey: "Cannot verify — no connection" | Waits / retries; never lets out on this screen |

5. **Next** clears the screen and refocuses the field.

A retry after a lost reply is never re-approved: the second answer is
`ALREADY_USED` ("by you").

## 4. Check, lookup by number, reprint

**Check ticket** (all three jobs; read-only). Scan or type the QR → the backend
returns the payment status, validation status, fee and times, with the result:
`ACTIVE` (paid, not validated, not expired), `PAYMENT_REQUIRED`, `ALREADY_USED`,
`EXPIRED`, `NOT_FOUND` or `INVALID_QR`. Nothing changes. Every check is a
recorded scan.

**Lookup by number** (entry and payment operators). Customers quote the last
characters of the ticket number, which are not unique. The operator types 3 or
more trailing characters; the backend returns **today's** matching tickets
(vehicle type, issue time, payment and validation status; never the token) and
the operator picks one. No match is a 404, the same as every miss. The exit
never accepts a ticket number: only the QR.

**Reprint** (entry operators only): from the recent list or a lookup. Today's
tickets that are not validated only; the same QR; audited with the actor and
the original issuer. Every miss is the same 404.

## 5. Admin Portal

- **Sign in** (ADMIN only).
- **Vehicle types & prices**: add, rename, set price (kobo, shown as naira),
  enable/disable. Changes are audited. A price change never changes a ticket
  already issued.
- **Settings**: site display name, organisation name and contact line (printed
  on the ticket), payment window (how long a pending card payment blocks its
  operator), Paystack mode shown read-only. There is no validity-hours setting:
  a ticket is valid on the day it was issued.
- **Locations**: entry gates, payment booths and exit gates; create, rename,
  take out of service.
- **Operators**: create accounts with one job (entry, payment, exit) and one
  location of the matching kind; activate/deactivate; reset password; **delete**.
  Delete is a soft delete: the account disappears from the accounts list and
  every picker, cannot sign in, and its sessions end at once; its username can
  be reused; its history stays (tickets, payments, scans and audit rows still
  show the operator's name in reports). Nobody can delete or deactivate their
  own account or the last active admin. Audited (`USER_DELETED`).
- **Transactions**: list and search (ticket number, payment reference), filter
  by date, location, operator, category, payment method and status. The detail
  view shows the ticket, its payments and every scan.
- **Incomplete sessions**: tickets issued on a day that were never validated at
  exit, unpaid or paid, per day, entry gate, booth and operator, so the admin
  can spot vehicles let out without being scanned. For **today** the list also
  holds vehicles still inside, so today's rows are shown as "in progress", not
  as incomplete; only a day that has ended has incomplete sessions.
- **Finance / Revenue**: cash and card revenue separately and in total, per day,
  per booth and per operator, to compare recorded cash with the physical cash.
- **Dashboard**: today and a chosen date range — tickets issued (per entry gate
  and category), payments and amount collected (cash and card separately and
  in total), unpaid tickets, tickets validated at exit, incomplete sessions,
  per location and per operator.
- **Export**: CSV of the filtered transactions and reports. Excel and PDF are
  to be confirmed with management (Phase 2).
- No refunds, reversals or status corrections anywhere in the portal.
- No device registry: devices are controlled through accounts only.

## 6. Background jobs

- Card payments: delayed verify checks inside the payment window (20, 45, 90,
  150 and 240 s; 3 s first when Paystack did not answer the start), then a
  sweep every 2 minutes for anything still PENDING. Past the window, a payment
  Paystack says is not paid becomes ABANDONED. A check moves a payment only on
  Paystack's answer.
- No job expires tickets: EXPIRED is derived from `valid_until` on the database
  clock.

## 7. Rules that apply everywhere

- Kobo integers; the backend sets amounts; UTC stored, Lagos shown.
- A device never supplies a time. `valid_until` and the exit test use the
  database clock.
- PAID only from a Paystack-confirmed card payment or a booth cash
  confirmation; VALIDATED only when PAID.
- Scanned codes and tokens are never written to logs or error messages.
- Every config change, every cash confirmation, every reprint and every account
  change is audited (who, what, when).
- No offline approval and no offline payment.
