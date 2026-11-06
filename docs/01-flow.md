# 01 — How the system behaves

Master reference. If code disagrees with this file, the code is wrong or this
file is stale: say which.

## Actors

- **Entry operator** at an entry gate, with the Android app in Entry mode.
- **Exit operator** at an exit gate, with the app in Exit mode.
- **Customer**, with or without a vehicle. Never logs in; holds a paper ticket.
- **Admin**, in the web Admin Portal.
- **Paystack**, the only source of truth that a payment succeeded.

## 1. Entry: take payment, issue a ticket

1. Operator signs in. The app opens in Entry mode (from the operator's role)
   and shows the operator's gate.
2. Operator taps **New ticket**.
3. Operator types the customer's **name** (optional, see open questions) and
   picks the **vehicle type** from a list. The list and its prices come from
   the backend.
4. The app shows the **amount** the backend returned for that type
   (e.g. "₦500.00"). The app never computes or edits it.
5. Operator taps **Take payment**. The app sends: category code, name, and an
   idempotency key for this attempt. The backend:
   - snapshots the price, creates a PENDING payment with our own reference,
   - takes the operator's payment-in-progress lock,
   - starts the Paystack transaction and returns what the app needs to show
     Paystack's checkout.
6. The customer pays on Paystack's checkout (card, transfer, USSD) on the
   device.
7. The app waits. It shows "Waiting for Paystack to confirm…". It never treats
   the checkout closing, or any message from the device, as success.
8. The backend marks the payment SUCCESS only when:
   - a signed Paystack webhook arrives for our reference, or
   - after ~20 s without a webhook, Paystack's verify call says success.
   At that moment, in one transaction, it creates the **ticket**: random QR
   token, ticket number, `paid_at`, `valid_until = paid_at + validity hours`,
   snapshot of category name and amount, Paystack reference, operator, gate.
9. The app sees the ticket and shows it, then **prints** it.
10. Failed / abandoned / still pending:
    - FAILED or ABANDONED: the app says so plainly; no ticket; the operator can
      start again (a new attempt).
    - Still pending after the wait: the app says "Not confirmed yet" and keeps
      checking. A background job re-checks pending payments; if Paystack later
      confirms, the ticket is created and appears in the operator's recent
      list for printing.

### The ticket (printed and on screen)

- Header: organisation / site name (from receipt settings) and logo(s)
- **QR** (opaque token only)
- Customer name (if given) · Vehicle type · Amount paid
- Date and time paid (Africa/Lagos) · **Valid until**
- Paystack reference · Ticket number · Gate / operator
- A line: "Show this ticket at the exit. It is valid once."

**Reprint**: entry operators can reprint a ticket from their recent list or by
ticket number. Same QR. The reprint is logged.

## 2. Exit: validate and close

1. Operator signs in; the app opens in Exit mode and shows the gate.
2. The field is focused. The operator scans the ticket with the built-in
   scanner, or taps **Scan with camera**. The scan only fills the field.
3. Operator taps **Validate**. The backend, in one conditional update:
   - marks the ticket USED if it is ACTIVE and not expired → `VALID`,
   - otherwise returns the reason without changing anything.
4. The result fills the screen in large type and colour:

| Result | Screen | Operator does |
|---|---|---|
| `VALID` | Green: "Valid — allow exit", name, vehicle type, paid time | Lets the vehicle out |
| `ALREADY_USED` | Red: "Already used", when, which gate, which operator | Refuses |
| `EXPIRED` | Red: "Expired", valid-until | Refuses (sends to entry to pay) |
| `NOT_FOUND` | Red: "Ticket not found" | Refuses |
| `INVALID_QR` | Red: "Not one of our tickets" | Refuses |
| No connection | Grey: "Cannot verify — no connection" | Waits / retries; never lets out on this screen |

5. **Next** clears the screen and refocuses the field.

## 3. Check ticket (both modes)

Read-only. Scan or type → the backend returns the status and details
(ACTIVE with valid-until / USED with when and where / EXPIRED / NOT_FOUND /
INVALID_QR). Nothing changes. Used at entry to catch a customer who returns
with an old ticket (e.g. one never scanned at exit the day before). An old
ticket is either USED or EXPIRED, so it is refused.

## 4. Admin Portal

- **Sign in** (ADMIN only).
- **Vehicle types & prices**: add, rename, set price (kobo, shown as naira),
  enable/disable. Changes are audited.
- **Settings**: validity hours, site display name, receipt details
  (organisation name, contact line, logo choice), Paystack mode shown
  read-only.
- **Gates & operators**: create gates (entry/exit), create operator accounts,
  assign each to a gate, activate/deactivate, reset password.
- **Transactions**: list and search (ticket number, Paystack reference,
  customer name), filter by date, gate, operator, status. Detail view shows
  payment, ticket and every scan.
- **Open tickets** (the exit-discipline tracker):
  - ACTIVE tickets now (paid, not yet exited, still valid),
  - **expired without exit** per day, per entry gate, per exit gate's shift —
    a high count means exits are not being scanned.
- **Dashboard**: today and a chosen date range — payments, amount collected,
  failed/abandoned payments, tickets issued, tickets used, active, expired
  without exit, per gate.
- **Export**: CSV of transactions for the filtered range.

## 5. Background jobs

- Pending-payment re-check (verify with Paystack) every few minutes, up to the
  payment window; then ABANDONED.
- No job is needed to expire tickets: EXPIRED is derived from `valid_until`.

## 6. Rules that apply everywhere

- Kobo integers; backend sets amounts; UTC stored, Lagos shown.
- A device never supplies a billing or validity time.
- Scanned codes and tokens are never written to logs.
- Every config change and every reprint is audited (who, what, when).
