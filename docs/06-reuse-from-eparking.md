# 06 — What to reuse from eparking

`C:\Dev\eparking` is read-only. Copy and adapt; never edit it, never import from
it. Say in each report which files you copied.

As of eparking commit `30c744a`. The scanner files (`ScanBurst.kt`,
`ScannerKeys.kt`) were staged but not yet committed in eparking when this was
written; copy them only from a committed version and note the commit.

## Backend (`C:\Dev\eparking\backend\src`)

| eparking | Reuse for | Adapt |
|---|---|---|
| `auth/` | Login, refresh, guards, Argon2 | Roles become ADMIN / ENTRY_OPERATOR / EXIT_OPERATOR |
| `staff/` | Operator accounts, password rules | Add gate assignment |
| `paystack/` | Paystack client, initialize, verify, webhook signature | Keep as is where possible |
| `payments/` | PENDING → SUCCESS/FAILED/ABANDONED, idempotent settle, verify after ~20 s, unwind | Payment is for a ticket, not a visit |
| `lock/` | Redis payment-in-progress lock | Lock per operator, not per visit |
| `jobs/` | Pending re-check job (BullMQ) | Same |
| `audit/` | Audit log | Same |
| `config/` | Categories, settings, gates, audited changes | Flat price per category; validity hours; receipt details |
| `site.service.ts`, `seed-site.ts`, `seed-test-data*.ts` | Site, first admin, guarded test data | New categories/prices as TEST VALUES; no passes, no hourly |
| QR token creation in `visits/` | Opaque random token | Ticket token |
| `app.setup.ts`, `main.ts`, `health.controller.ts` | Bootstrap, health | Same |

Not needed: `visits/` flow logic, `pricing/` (hourly), `passes/`,
`master-card/`, `camera-capture/`, `finance/` (beyond ideas for the dashboard).

## Android (`C:\Dev\eparking\android`)

| eparking | Reuse for |
|---|---|
| `pos/.../LoginActivity.kt`, `Session.kt`, `BackendClient.kt` | Login, tokens, API client |
| `pos/.../CheckoutSheet.kt`, `CheckoutPage.kt`, `CheckoutNavigation.kt`, `VisitPayment.kt` | Paystack checkout and waiting for confirmation |
| `pos/.../CounterPrint.kt`, `CounterPaper.kt`, `TicketHeader.kt` | Android printing, ticket layout, header rules (the `TicketHeader.kt` layout rules for two logos and a centred brand line) |
| `pos/.../ScanActivity.kt`, `ScanScreenState.kt` | Camera scan |
| `dispenser/...` `ScanBurst.kt`, `ScannerKeys.kt` (scanner focus and keyboard-wedge capture) | Built-in scanner support |
| `pos/.../CategoryPick.kt` | Vehicle type list |
| `build-logic/` and `android/BUILDING.md` | Release signing, APK naming, HTTPS-only release |
| Theme, colours | Same look |
| `pos/app/src/main/res/drawable-nodpi/gsd_logo.png`, `aic_logo.png` (at 359c0c1) | Ticket header: GSD logo left, AIC logo right |

Lessons already learned there (do not repeat):
- Choose hardware by capability, never by device model name.
- A scan only fills a field; Enter from a scanner never submits.
- Focus the scan field when the screen opens and after every fill.
- Never show "confirmed" until the backend says the payment succeeded.

## Admin Portal (`C:\Dev\eparking\admin`)

| eparking | Reuse for |
|---|---|
| `app/login`, `middleware.ts`, `(portal)/shell.tsx`, `(portal)/ui.tsx`, `(portal)/pager.tsx` | Login, layout, tables, paging |
| `(portal)/staff` | Operators page |
| `(portal)/settings` | Settings page |
| `(portal)/finance` | Ideas for the dashboard and transaction list |
| `globals.css`, `public/gsd-logo.png` (at 359c0c1) | Same look; the portal logo |

## Deployment

| eparking | Reuse for |
|---|---|
| `render.yaml` | Blueprint (rename services; `rootDir`/`dockerContext` lesson) |
| `docs/deploy-render-test.md` | Runbook |
| `.github/workflows/` | CI |

## Ticket branding (decided 2026-11-07)

The ticket header follows eparking's `pos/.../TicketHeader.kt` layout rules,
with the GSD logo on the left and the AIC logo on the right (the two PNGs
above). The brand line between them is **not** "E-Parking": it is the site's
organisation name (`receipt_org_name`, else the display name) with the
contact line (`receipt_contact_line`) beneath, both edited in the Admin Portal.
The files are copied in the Android sprint (4a) and the portal sprint (5),
each copy listed with its source path in that sprint's report.

## Copied in Sprint 4a (from eparking 359c0c1)

Every file below was copied from eparking at commit `359c0c1` and adapted;
eparking itself was not changed. "Unchanged" means byte-identical.

| qrpark file | Source in eparking | What changed |
|---|---|---|
| `android/app/src/main/res/drawable-nodpi/gsd_logo.png` | `android/pos/app/src/main/res/drawable-nodpi/gsd_logo.png` | Unchanged |
| `android/app/src/main/res/drawable-nodpi/aic_logo.png` | `android/pos/app/src/main/res/drawable-nodpi/aic_logo.png` | Unchanged |
| `android/app/src/main/java/ng/gsds/qrpark/TicketHeader.kt` | `android/pos/.../TicketHeader.kt` | Logo order, INLINE/STACKED rule and `wrapWords` kept; the fixed "E-Parking" title and `siteDisplayName()` replaced by `HeaderText` (organisation name, else display name, plus the contact line) |
| `android/app/src/main/java/ng/gsds/qrpark/TicketPrint.kt` | `android/pos/.../CounterPrint.kt` | `CounterPrinter`/`PaperDocument`/`PaperArt` kept; one paper (the entry ticket), brand and contact lines, job and PDF names without "E-Parking", behind a `TicketPrinter` interface chosen by capability; QR drawn with zxing core |
| `android/app/src/main/java/ng/gsds/qrpark/TicketPaper.kt` | `android/pos/.../CounterPaper.kt` | Only the ticket-reprint idea (header + one QR + monospace lines) kept; receipt, visit and pass papers dropped; naira formatting by string work only |
| `android/app/src/main/java/ng/gsds/qrpark/CategoryPick.kt` | `android/pos/.../CategoryPick.kt` | The three functions unchanged; comments about passes reworded |
| `android/app/src/test/java/ng/gsds/qrpark/CategoryPickTest.kt` | `android/pos/app/src/test/.../CategoryPickTest.kt` | Package and the class comment changed; the tests unchanged |
| `android/app/src/main/java/ng/gsds/qrpark/LoginActivity.kt` | `android/pos/.../LoginActivity.kt` | Username, not email; routing by the account's job; the backend's message or a fixed sentence on failure |
| `android/app/src/main/java/ng/gsds/qrpark/Session.kt` | `android/pos/.../Session.kt` | Plain SharedPreferences replaced by the encrypted `SecureStore`; the location (gate) and its kind kept; counter-only fields dropped; the open entry attempt and the installation id added |
| `android/app/src/main/java/ng/gsds/qrpark/BackendClient.kt` | `android/pos/.../BackendClient.kt` | Same `HttpURLConnection` transport and one-refresh-on-401 rule; the `Log.w` removed (no logging at all); this app's routes; `X-Device-Id` on every ticket call |
| `android/app/src/main/res/values/colors.xml`, `themes.xml`, `styles.xml`, `type.xml` | `android/pos/app/src/main/res/values/` (same names) | Names `EParking` → `QrPark`; data-series colours dropped; bundled fonts not copied (platform sans and monospace) |
| `android/app/src/main/res/xml/network_security_config.xml` and `src/debug/res/xml/network_security_config.xml` | `android/pos/app/src/{main,release}/res/xml/network_security_config.xml` | The emulator cleartext exception moved from main into the debug source set; main (release) allows no cleartext |
| `android/build-logic/` (`ReleaseRules.kt`, `QrparkReleasePlugin.kt`, `ReleaseRulesTest.kt`, `build.gradle.kts`, `settings.gradle.kts`) | `android/build-logic/` | Package and property names `qrpark.*`; one app, no flavours; `debugApk` (named APK + `.sha256`, previous one deleted) in place of `vendorApk` |
| `android/BUILDING.md` | `android/BUILDING.md` | One app, `qrpark.*` properties, debug APK, emulator steps; vendor flavour sections dropped |

Written new for 4a, not copied: `SecureStore.kt` and `Envelope.kt` (Keystore
AES-GCM storage), `EntryAttempt.kt`, `NewTicketFlow.kt`, `Naira.kt`,
`Modes.kt`, `CheckView.kt`, `DeviceId.kt`, `UiBits.kt`, the activities other
than sign-in, and their tests.
