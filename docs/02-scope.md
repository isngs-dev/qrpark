# 02 — Scope

Source: "Scope of Work – QR-Based Market Parking Payment & Validation System"
(management), narrowed by the decisions of 2026-11-07 (`CLAUDE.md`) for a fast
festive-season launch. Anything not in the MVP list waits for Phase 2.

## MVP (festive launch)

**Android app (one app; Entry, Booth and Exit modes)**
- Operator login; the mode and location come from the account. No switching.
- Entry: pick the vehicle category (no customer data), ticket created at once
  (UNPAID), print the QR ticket (Android print), recent list, lookup by number,
  reprint, check.
- Booth: scan (camera or built-in scanner) or look up by number, check, then
  take payment: **cash** (one confirmation button) or **card** (Paystack
  checkout, PAID only when Paystack confirms).
- Exit: scan, validate once (PAID only), big clear result including "Payment
  required"; check.
- Works on Android 10+ (tested on the emulator); built so the Paystack Terminal
  (M960) can be added as the final device.

**Backend**
- Auth and roles (ADMIN, ENTRY_OPERATOR, PAYMENT_OPERATOR, EXIT_OPERATOR);
  locations (entry gates, booths, exit gates); categories and prices;
  settings; accounts including soft delete.
- Tickets: created at entry with a fee snapshot and same-day validity; lookup
  by trailing characters; reprint.
- Payments: cash confirmation at the booth; card with Paystack (initialize,
  signed webhook, verify fallback with delayed checks, background re-check,
  idempotency, per-operator lock); database guards against double payment.
- Atomic single-use exit validation requiring PAID; read-only check; scan log;
  audit log.

**Admin Portal**
- Login; vehicle types & prices; settings (site name, organisation name and
  contact line, payment window); locations; operators (create, assign,
  deactivate, delete, reset password); transactions list/search/detail;
  incomplete sessions; finance / revenue (cash vs card); dashboard; CSV export.

**Deployment**
- Render test environment, seed scripts, test data (TEST VALUE prices).

## Phase 2 (after launch)

- Paystack Terminal (M960) card adapter, terminal printing and scanning —
  after Paystack answers and approves.
- Excel and PDF report exports — TO CONFIRM with management (CSV in release 1).
- Finer role permissions.
- Production hosting move if required (the scope document suggests AWS).

## Out of scope (scope document §7, and our decisions)

- ANPR, plate numbers, vehicle registration; any customer data (name, phone)
- Parking duration, time tracking, hourly or time-based fees
- Ticket dispenser integration (operators hand tickets over); other printers
- Barrier integration
- Occupancy / slot management
- Customer mobile app, customer accounts, SMS/email
- Refunds, payment reversals, status corrections and supervisor overrides, in
  the app and in the admin (card refunds in the Paystack dashboard only)
- Offline validation and offline payment synchronisation
- Device registry (decided 2026-11-07: devices are controlled through accounts
  only; the scope document lists one — TO CONFIRM with management)
- A switch to enable or disable payment methods (the scope document §4.4A
  lists one; not in the decisions — TO CONFIRM with management)
- More than one market per deployment
- Advanced analytics / BI
