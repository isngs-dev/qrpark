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
| `lib/cookie-names.ts`, `lib/session.ts`, `lib/api.ts`, `lib/auth-actions.ts`, `lib/config*.ts`, `lib/staff*.ts`, `(portal)/icons.tsx`, `(portal)/layout.tsx`, `app/layout.tsx` (added in Sprint 5b, review decision) | What the login, shell, settings and staff pages import: session cookies, the server-side API client, sign-in, configuration and account reads and writes |

## Deployment

| eparking | Reuse for |
|---|---|
| `backend/Dockerfile` | The backend image (adapted in Sprint 6a: non-root user, `.dockerignore`) |
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

## Copied in Sprint 4b (from eparking 359c0c1)

The booth's scanner. eparking itself was not changed. `VisitPayment.kt` is
not copied: the booth's payment rules are this app's own (`BoothRules.kt`).
(4b first opened the checkout in the system browser; the 4b fix round moved it
inside the app with eparking's sheet, below.)

| qrpark file | Source in eparking | What changed |
|---|---|---|
| `android/app/src/main/java/ng/gsds/qrpark/ScanBurst.kt` | `android/dispenser/.../ScanBurst.kt` | Package; the log-line helpers (`keyKind`, `scannerKeyLogLine`, `burstLogLine`) removed; gate wording in comments made general |
| `android/app/src/main/java/ng/gsds/qrpark/ScannerKeys.kt` | `android/dispenser/.../ScannerKeys.kt` | Package; the vendor-only key logging removed (no `Log` call left) |
| `android/app/src/main/java/ng/gsds/qrpark/ScanFill.kt` | `android/dispenser/.../ScanFill.kt` | Package; `CodeScanner` (with `Unready`) dropped; the `ScannerKind` comment points at this app's chooser |
| `android/app/src/main/java/ng/gsds/qrpark/ScanTextField.kt` | `android/dispenser/.../ScanTextField.kt` | Package only |
| `android/app/src/main/java/ng/gsds/qrpark/QrDecoder.kt` | `android/dispenser/.../Hardware.kt` (`object QrDecoder` only) | The twin note removed |
| `android/app/src/main/java/ng/gsds/qrpark/ScanScreenState.kt` | `android/pos/.../ScanScreenState.kt` | Package only |
| `android/app/src/main/java/ng/gsds/qrpark/ScanActivity.kt` | `android/pos/.../ScanActivity.kt` | The scan goes to `ScanHand` (memory) and the screen closes: eparking put the token in an Intent extra, which this app forbids; the manual-entry dialog dropped (the booth's own field takes typing); `QrDecoder` in place of `QrCodec`; the camera chosen by capability (`scannerKind`) |
| `android/app/src/main/res/layout/activity_scan.xml` | `android/pos/app/src/main/res/layout/activity_scan.xml` | Manual-entry button replaced by Close |
| `android/app/src/test/java/ng/gsds/qrpark/ScanBurstTest.kt` | `android/dispenser/app/src/test/.../ScanBurstTest.kt` | Package; the log-line test removed with the log helpers |
| `android/app/src/test/java/ng/gsds/qrpark/ScanFillTest.kt` | `android/dispenser/app/src/test/.../ScanFillTest.kt` | Package only |
| `android/app/src/test/java/ng/gsds/qrpark/ScanScreenStateTest.kt` | `android/pos/app/src/test/.../ScanScreenStateTest.kt` | Package only |

Written new for 4b, not copied: `BoothRules.kt`, `PaymentAttempts.kt`,
`BoothActivity.kt`, `EntryPanel.kt` (A4a-1), their tests, and the backend's
`POST /payments/:id/cancel`.

## Copied in the Sprint 4b fix round (from eparking 359c0c1)

The Paystack checkout inside the app, as in eparking's POS (this reverses the
4b "system browser" choice). The sheet stays a viewport with no authority over
the payment.

| qrpark file | Source in eparking | What changed |
|---|---|---|
| `android/app/src/main/java/ng/gsds/qrpark/CheckoutSheet.kt` | `android/pos/.../CheckoutSheet.kt` | The first address must pass `checkoutToOpen()` (https on a Paystack host), else a plain error and nothing loads; WebView hardened: file and content access off, mixed content never, no form saving, web-contents debugging off, no JavaScript bridge, SSL errors cancelled; the failure view shows a sanitised code, never the address; on close the cache, cookies, web storage, form data and history are cleared; this app's strings, colours and system-bar padding |
| `android/app/src/main/java/ng/gsds/qrpark/CheckoutPage.kt` | `android/pos/.../CheckoutPage.kt` | Package; `pageFailureReason()` added (only a `net::ERR_` code is shown) |
| `android/app/src/main/java/ng/gsds/qrpark/CheckoutNavigation.kt` | `android/pos/.../CheckoutNavigation.kt` | Package; **https only** (eparking also allowed http) |
| `android/app/src/test/java/ng/gsds/qrpark/CheckoutPageTest.kt` | `android/pos/app/src/test/.../CheckoutPageTest.kt` | Package; a test for `pageFailureReason()` added |
| `android/app/src/test/java/ng/gsds/qrpark/CheckoutNavigationTest.kt` | `android/pos/app/src/test/.../CheckoutNavigationTest.kt` | Package; the http case now expects BLOCK, and a test that http is refused on every host and frame |
| `android/app/src/main/res/values/strings.xml` (the `checkout_*` strings) | `android/pos/app/src/main/res/values/strings.xml` | Reworded for the booth; "sandbox" dropped from the title; `checkout_not_paystack` added |

Written new in the fix round: `WebViewRulesTest.kt` (the WebView's source rules).

## Copied in Sprint 4c (from eparking 359c0c1)

| qrpark file | Source in eparking | What changed |
|---|---|---|
| `android/app/build.gradle.kts` (the `signingConfigs` block and `signingConfig = signingConfigs.findByName("release")`) | `android/pos/app/build.gradle.kts` | `qrpark.signing.*` property names; nothing else |
| `android/BUILDING.md` ("The signing key") | `android/BUILDING.md` ("The signing key (one-time, by hand)") | One app; `qrpark-release` alias and folder; the vendor wording dropped; "you make and back up your own key" |

Exit mode reuses this app's own booth pieces (ScanTextField, ScannerKeys,
ScanActivity, ScanHand); nothing else was copied in 4c.

## Copied in Sprint 5b (from eparking 359c0c1)

The Admin Portal shell and configuration pages. The eparking-only parts were
left out: passes, pass plans, pricing periods, devices, the FINANCE role, the
dashboard (5c) and the cursor pager (5c, if needed). "Unchanged" means
byte-identical.

| qrpark file | Source in eparking (`admin/`) | What changed |
|---|---|---|
| `admin/app/(portal)/icons.tsx` | `app/(portal)/icons.tsx` | Unchanged |
| `admin/app/(portal)/ui.tsx` | `app/(portal)/ui.tsx` | Unchanged |
| `admin/app/(portal)/settings/form-bits.tsx` | `app/(portal)/settings/form-bits.tsx` | Unchanged |
| `admin/public/gsd-logo.png` | `public/gsd-logo.png` | Unchanged |
| `admin/app/globals.css` | `app/globals.css` | System fonts instead of the Google faces (nothing fetched from a third party); tokens, themes and shell grid unchanged |
| `admin/app/layout.tsx` | `app/layout.tsx` | No `next/font/google`; theme key `qrpark-theme`; title |
| `admin/app/(portal)/shell.tsx` | `app/(portal)/shell.tsx` | Storage keys `qrpark-sidebar`/`qrpark-theme`; "QR Parking · Admin"; the header shows the username (no email) |
| `admin/app/(portal)/layout.tsx` | `app/(portal)/layout.tsx` | ADMIN only (`mayUsePortal`); qrpark's nav (Overview, Configuration, Operators); site name from the sign-in answer, not `NEXT_PUBLIC_SITE_NAME`; `force-dynamic` |
| `admin/app/login/page.tsx`, `login-form.tsx` | `app/login/page.tsx`, `login-form.tsx` | Username, not email; QR Parking wording; no site-name environment variable |
| `admin/middleware.ts` | `middleware.ts` | eparking only checked a cookie was present. This one also refreshes an expired access cookie once and writes the new pair; a refused refresh clears every cookie and goes to /login; an unreachable backend keeps the session; on /login a live session returns to the portal; `runtime: 'nodejs'` |
| `admin/lib/cookie-names.ts` | `lib/cookie-names.ts` | `qp_` names with the `__Host-` prefix in production; the cookie options moved here (httpOnly, SameSite=Lax, Secure in production, path /, no Domain); access cookie 14 minutes (dies before the 15-minute token) |
| `admin/lib/session.ts` | `lib/session.ts` | Options and names from `cookie-names.ts`; `PortalUser` with username and site name; `PORTAL_ROLES` replaced by `mayUsePortal` (ADMIN only) |
| `admin/lib/api.ts` | `lib/api.ts` | Backend address from the server-only `QRPARK_API_URL` (`lib/backend-url.ts`, new) instead of `NEXT_PUBLIC_API_URL`; login by username; `logout()` added; an ended session clears the cookies and redirects to /login; the "cannot reach" message no longer names the backend's address; `publicApi` dropped |
| `admin/lib/auth-actions.ts` | `lib/auth-actions.ts` | Username; ADMIN only, nothing stored for an operator account; sign-out also ends the admin's sessions at the backend (`POST /auth/logout`) |
| `admin/lib/config.ts`, `config-types.ts`, `config-actions.ts` | `lib/config.ts`, `config-types.ts`, `config-actions.ts` | qrpark's `/admin/categories`, `/admin/settings`, `/admin/gates`; a category's flat price (`changePrice`); three location kinds; `naira()` by string work; `koboFromNaira()` by digits; `lagosTime()`; pricing rules, pass plans, devices and site-config fields dropped |
| `admin/lib/users.ts`, `users-types.ts`, `users-actions.ts` | `lib/staff.ts`, `staff-types.ts`, `staff-actions.ts` | Usernames; four roles, each with one location of its kind (`operatorProblem`); `passwordProblem` (12+); `lockoutWarning` (yourself, the last active admin); delete (soft) added; no message ever names the password; dashboard shapes dropped |
| `admin/app/(portal)/operators/page.tsx`, `operators-manager.tsx` | `app/(portal)/staff/page.tsx`, `staff-manager.tsx` | Job and location together (location choices follow the job); deactivate; delete with a confirm step; password reset in a password field that starts empty |
| `admin/app/(portal)/settings/layout.tsx`, `page.tsx`, `settings-form.tsx` | `app/(portal)/settings/layout.tsx`, `page.tsx`, `site-config-form.tsx` | qrpark's three tabs; site name, ticket lines, payment window, Paystack mode read-only; the FINANCE banner dropped |
| `admin/app/(portal)/settings/categories/page.tsx`, `categories-manager.tsx` | `app/(portal)/settings/categories/page.tsx`, `categories-manager.tsx` | A flat price per vehicle type with "Set price" ("applies to new tickets"); readOnly mode dropped |
| `admin/app/(portal)/settings/locations/page.tsx`, `locations-manager.tsx` | `app/(portal)/settings/gates/page.tsx`, `gates-manager.tsx` | Entry gates, booths, exit gates; devices dropped |

Written new in Sprint 5b: `admin/lib/backend-url.ts` (since Hardening H3 `admin/lib/backend-url.mjs`, so `next.config.mjs` can load the same rule), `admin/app/(portal)/page.tsx`
(the overview), `admin/next.config.mjs` (security headers), and the tests
`admin/tests/rules.test.ts` and `admin/tests/source-scan.test.ts`.

## Copied in Sprint 5c (from eparking 359c0c1)

The report pages. eparking's finance and audit pages were read for ideas
only (eparking has no CSV download); nothing else was copied.

| qrpark file | Source in eparking (`admin/`) | What changed |
|---|---|---|
| `admin/app/(portal)/pager.tsx` | `app/(portal)/pager.tsx` | Numbered pages ("Page N of M", previous / next) instead of cursors, since the 5a routes page by number; both ends still always drawn, a dead end greyed; `lib/pagination.ts` not copied (`pageLinks` in `lib/reports-types.ts`) |

Written new in Sprint 5c: `admin/lib/reports-types.ts`, `admin/lib/reports.ts`,
`admin/lib/csv-route.ts`, `admin/app/csv/[report]/route.ts` (the read-only CSV
download, GET only), `admin/app/(portal)/report-frame.tsx`, the dashboard,
transactions (and ticket detail), incomplete sessions, finance and audit pages,
`lagosDay()` in `lib/config-types.ts`, and `admin/tests/reports.test.ts`.
