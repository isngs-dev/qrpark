# 02 — Scope

Source: "Scope of Work – QR-Based Parking Payment & Validation System" (client
document), narrowed for a fast festive-season launch. Anything not in the MVP
list waits for Phase 2.

## MVP (festive launch)

**Android app (one app, Entry and Exit modes)**
- Operator login; mode and gate from the account.
- Entry: name (optional), vehicle type, amount from backend, take payment via
  Paystack checkout, ticket issued only after Paystack confirms, print, reprint.
- Exit: scan (camera or built-in scanner), validate once, big clear result.
- Check ticket in both modes (read-only).
- Works on Android 10+ phones for testing; built so the Paystack Terminal
  (M960) can be added as the final device.

**Backend**
- Auth and roles; categories and prices; settings; gates and operators.
- Payments with Paystack: initialize, signed webhook, verify fallback,
  background re-check, idempotency, payment-in-progress lock.
- Ticket issue on confirmation; atomic single-use exit validation; read-only
  check; scan log; audit log.

**Admin Portal**
- Login; vehicle types & prices; settings (validity hours, site name, receipt
  details); gates & operators; transactions list/search/detail; open tickets and
  expired-without-exit tracker; dashboard; CSV export.

**Deployment**
- Render test environment, seed scripts, test data (TEST VALUE prices).

## Phase 2 (after launch, from the scope document)

- Paystack Terminal (M960) payment adapter, terminal printing/scanning — after
  Paystack answers and approves.
- Reports in Excel and PDF: daily collection, payment method, entry gate, exit
  gate, operator, QR status, failed transactions.
- POS device registry (register devices, map to gates, last sync, activate /
  deactivate).
- Finer role permissions; managing failed / cancelled / refunded transactions
  subject to permissions.
- Production hosting move if required (scope suggests AWS).

## Out of scope (scope document §6, and our own)

- ANPR, plate numbers, vehicle registration management
- Parking duration, time tracking, hourly or time-based fees
- Barrier integration
- Occupancy / slot management
- Customer mobile app, customer accounts, SMS/email
- Cash payments
- Refunds inside the app (Paystack dashboard only)
- Offline validation
- Advanced analytics / BI
