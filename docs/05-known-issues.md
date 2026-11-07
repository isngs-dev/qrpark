# 05 — Known issues

The tracker. One row per issue. IDs: H (high), M (medium), L (low), T
(temporary or to confirm). Never delete a row; mark it fixed with the commit.

| ID | Status | Found | Issue | Notes |
|---|---|---|---|---|
| L1 | Open | Sprint 0 | npm audit: 1 high, 1 moderate in postcss bundled inside next@15.5.29; only fix is next@16 (breaking). We process no untrusted CSS. | Revisit in Sprint 5. |
| M1 | Open | Sprint 1 | No login throttling yet: `POST /auth/login` can be tried without limit. Argon2id slows each guess but does not stop an online attack. | Decide before go-live. Not built. |
| T1 | Closed | Sprint 1 | Default ticket validity was 12 hours, an assumption for testing. | Closed by the decision of 2026-11-07: a ticket is valid on its day of issue only (Africa/Lagos); the `validity_hours` setting is removed in Sprint R (migration 0003). |
| T2 | Open | Sprint 1 | Receipt branding. Narrowed 2026-11-07: the logos are decided (GSD left, AIC right, from eparking); only the **organisation name and contact text** printed on the ticket remain to be confirmed. | Both are edited in the Admin Portal settings (`receipt_org_name`, `receipt_contact_line`). |
| L2 | Open | Sprint 1 | `audit_log` TRUNCATE is not blocked by the append-only trigger (it guards UPDATE and DELETE only). | At deploy, the app's database user must not hold the TRUNCATE privilege. Sprint 6. |
| L3 | Open | Sprint 2 | BullMQ (the verify and sweep jobs) needs Redis to run with `maxmemory-policy noeviction`; any evicting policy can silently drop queued jobs. | Set at deploy. Sprint 6. |
| T3 | Open | Rework (2026-11-07) | Excel and PDF report exports are in the scope document; release 1 exports CSV only. | TO CONFIRM with management (Phase 2). |
| T4 | Open | Rework (2026-11-07) | The scope document lists a device registry (register POS devices, assign to locations, status, last activity). Decided: no registry; devices are controlled through accounts, `X-Device-Id` is recorded only. | TO CONFIRM with management that it stays out. |
| T5 | Open | Rework (2026-11-07) | The scope document (§4.4A) lists enabling or disabling payment methods (cash, card). Not in the decisions; not built. | TO CONFIRM with management. |
| T6 | Open | Rework (2026-11-07) | No public webhook URL yet: card payments settle through the verify checks. Whether the Paystack test webhook can be shared with eparking's test setup is open. | Settle before the Sprint 6 end-to-end run. |
| T7 | Open | Rework B (2026-11-07) | Cash while a card payment is pending: cash is refused (409, `pendingPaymentId`) while a card payment for the ticket is PENDING. If the customer gives up on the card and pays cash, the booth waits until that card payment leaves PENDING: a delayed Paystack check, or the 2-minute sweep once the payment window (5 minutes by default) has passed. Cash does not ask Paystack itself. | DECISION PENDING for Sprint 4b (booth screen): e.g. cash first checks a card payment past its window with Paystack (as card start does), and/or the booth screen says how long to wait. Until then the wait is the safe behaviour: no double charge. |
