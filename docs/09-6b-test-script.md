# 09 — Sprint 6b test script (end to end, real phones, live test server)

The server: api `https://qrpark-api.gsds.com.ng`, portal
`https://qrpark-admin.gsds.com.ng`, test site `garki-test` (seeded: admin
`admin1`; operators `entry-1`, `booth-1`, `exit-1`). Prices are TEST VALUES.
Paystack **test** mode only.

How to use this page:

- Do the steps in order. Each says what you do, **what you should see**, and
  **what to paste back** as proof.
- **PC** steps are Windows PowerShell; **droplet** steps are bash, signed in
  as `deploy` (`ssh -i $HOME\.ssh\qrpark_do deploy@<DROPLET_IP>`), in
  `/opt/qrpark`. One command per block.
- **Never paste a password, a ticket token, a QR's content, an access token,
  a Paystack key or the contents of `.env`.** Ticket numbers (like
  `K7MP-3QZ9`) and payment references (`QRP_...`) are fine to paste.
- Screenshots: phone screenshots are fine (no token is ever shown on screen;
  the QR image itself is fine on a test ticket).
- If something does not match **what you should see**, stop there and paste
  what you got.

---

## Part 0 — What to have ready

- [ ] **Phones**: three Android phones (Android 10 or newer), one per job:
  Entry, Booth, Exit. One phone works too, signing out and in between jobs,
  but the exit and booth steps are quicker with three. A fourth screen (PC
  or another phone) to show a ticket's QR to a phone's camera.
- [ ] **The APK** for the phones (section 1 below).
- [ ] **Passwords** (in your password manager, never typed into chat): the
  admin `admin1` and the three operators `entry-1`, `booth-1`, `exit-1`, as
  you set them when seeding.
- [ ] **Paystack**: sign-in to **qrpark's own Paystack test business**; its
  test webhook URL set to `https://qrpark-api.gsds.com.ng/paystack/webhook`
  (docs/07 step 10). **Test cards**: open
  `https://paystack.com/docs/payments/test-payments` and copy into your notes
  one card that **succeeds**, one that is **declined**, and the PIN / OTP /
  expiry / CVV each needs. (This script does not repeat card numbers: take
  them from Paystack's page.)
- [ ] **PC**: Windows PowerShell; your SSH key `qrpark_do`; Node.js 22 (for
  part G's request script); Microsoft Excel; Android platform tools (adb) if
  you install over USB.
- [ ] **Droplet**: you can sign in as `deploy` and use `sudo` (its password is
  in your password manager).

---

## Section 1 — The Android build

### 1.1 How the API address is set

The address is **baked into the APK at build time** with the Gradle property
`qrpark.apiBaseUrl` (it becomes `BuildConfig.API_BASE_URL`; the sign-in screen
shows it as `Server: ...`). There is no setting in the app to change it.

### 1.2 Which build

**Recommended: a release build signed with your own key.** It is the real
thing (the release network rules, no debug features), and the same key is
needed for go-live anyway: a phone only installs an update signed with the
key of the build already installed, so starting with your own key avoids an
uninstall later. One-time key set-up: `android/BUILDING.md`, "The signing key"
(the key and its four properties live only in your own
`C:\Users\<you>\.gradle\gradle.properties`, never in the repo).

**Allowed for this test: the debug build** (debug-signed), with the same
https address. The release rules are not touched by it: they apply only to
`releaseApk`. Differences: it is debuggable, and it carries the emulator-only
exception (cleartext to `10.0.2.2`, the emulator's view of a PC), which a phone
pointed at `https://qrpark-api.gsds.com.ng` never uses. Switching later to a
release-signed build means uninstalling the debug app first (the phone then
signs in again).

Build from a **committed, clean** checkout, so the APK's name does not end in
`-dirty` (never hand out a `-dirty` build).

### 1.3 Build it (PC)

```powershell
cd C:\Dev\qrpark
```

```powershell
git status --short
```

Must print nothing (a clean checkout).

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\.jdks\jbr-21.0.11"
```

Release (recommended; needs your key, as above):

```powershell
& "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.9-bin\90cnw93cvbtalezasaz0blq0a\gradle-8.9\bin\gradle.bat" -p android :app:releaseApk "-Pqrpark.apiBaseUrl=https://qrpark-api.gsds.com.ng"
```

or debug:

```powershell
& "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.9-bin\90cnw93cvbtalezasaz0blq0a\gradle-8.9\bin\gradle.bat" -p android :app:debugApk "-Pqrpark.apiBaseUrl=https://qrpark-api.gsds.com.ng"
```

The APK and its checksum land in `android\app\build\apk\`, named
`qrpark-<version>-release.apk` (or `-debug.apk`) with a `.sha256` beside it;
the build deletes the previous APK of the same kind. Check the checksum:

```powershell
Get-FileHash -Algorithm SHA256 (Get-ChildItem android\app\build\apk\*.apk).FullName
```

```powershell
Get-Content (Get-ChildItem android\app\build\apk\*.apk.sha256).FullName
```

The two hashes must be the same. Stop Gradle afterwards:

```powershell
& "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.9-bin\90cnw93cvbtalezasaz0blq0a\gradle-8.9\bin\gradle.bat" --stop
```

### 1.4 Install it on a phone

**Over USB (adb)**: on the phone, Settings → About phone → tap Build number 7
times → Developer options → USB debugging on. Connect, accept the prompt on
the phone, then:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r (Get-ChildItem C:\Dev\qrpark\android\app\build\apk\*.apk).FullName
```

Expect `Success`. **Or without a cable**: copy the `.apk` to the phone, open
it in Files, and allow "Install unknown apps" for Files when asked.

On Android 15 or newer a one-time notice may say the app "isn't 16 KB
compatible" (a camera library, known since Sprint 4b): tap OK.

When you are done with adb:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" kill-server
```

**Paste back**: the APK's file name and its SHA-256, and a screenshot of the
sign-in screen showing `Server: https://qrpark-api.gsds.com.ng`.

### 1.5 The app refuses http (proved before this script was written)

Three separate guards, each shown in `.evidence/sprint-6b-prep.txt`:

1. A **release** build refuses any address that is not `https://` before it
   compiles anything: with `-Pqrpark.apiBaseUrl=http://qrpark-api.gsds.com.ng`
   the build stops with *"A release build needs an https:// server address"*.
2. **Android itself** refuses cleartext: the release network config allows no
   cleartext to any host; the debug one allows only `10.0.2.2` (the emulator's
   view of a PC). Tests `SourceRulesTest` (10/10) and `ReleaseRulesTest`
   (16/16) pass.
3. **On a device**: a debug build pointed at a plain-http listener on the PC
   (`http://10.220.1.111:8099`), which the emulator could reach (a control
   request from the emulator's shell arrived), tried to sign in: the app said
   "Cannot reach the server" and the listener received **0 connections** —
   the request never left the phone. No request went to the live server.

---

## Part A — Sign-in, each operator at its own location

**A1.** Phone 1: open QR Parking, sign in as `entry-1`.
- **Should see**: the Entry screen; at the top
  "Test entry operator 1 · Test entry 1" and the site name.
- **Paste**: screenshot.

**A2.** Phone 2: sign in as `booth-1`.
- **Should see**: the Payment booth screen, "… · Test booth 1".
- **Paste**: screenshot.

**A3.** Phone 3: sign in as `exit-1`.
- **Should see**: the Exit screen, "… · Test exit 1".
- **Paste**: screenshot.

**A4.** Portal (PC browser): `https://qrpark-admin.gsds.com.ng`, sign in as `admin1`.
- **Should see**: the dashboard. An operator account is refused here:
  signing in as `entry-1` in the portal says "This portal is for
  administrators. Operator accounts sign in on the parking app."
- **Paste**: a screenshot of the dashboard and of the refusal.

## Part B — Entry ticket

**B1.** Entry phone: choose vehicle type **Car**, tap **New ticket**.
- **Should see**: the ticket with its QR, ticket number, fee (₦500.00, a TEST
  VALUE), "Valid today only", and "Pay at the payment booth. Show this ticket
  at the exit."
- **Paste**: the ticket number (call it **T1**) and a screenshot.

**B2.** Tap **Print** and save as PDF.
- **Should see**: the print preview with the GSD logo left, AIC logo right,
  the site's name, the QR and number; never "E-Parking".
- **Paste**: the PDF (or a screenshot of it).

**B3.** Make two more Car tickets: **T2** (for card), **T3** (for the card
cancel test). Keep each QR available (on screen via **Today's tickets**, or the
PDF on the PC).
- **Paste**: the ticket numbers T2 and T3.

## Part C — Booth: Check (read-only) and cash

**C1.** Exit phone: scan **T1** and tap **Validate** (before it is paid).
- **Should see**: red "Payment required — go to the payment booth". Never "Valid".
- **Paste**: screenshot.

**C2.** Booth phone: **Scan with camera** (or type into "Scan the ticket") → T1
→ **Check**. (Check is read-only; the booth always checks first after a scan.)
- **Should see**: Unpaid, "Take payment ₦500.00", the issue time; nothing changes.
- **Paste**: screenshot. Then in the portal, **Transactions** → search the last
  4 characters of T1: still **Unpaid**. Paste that screenshot.

**C3.** Booth phone, on T1's screen: **Cash** → **Confirm ₦500.00 cash
received** (once; no "are you sure").
- **Should see**: "Paid" with the time.
- **Paste**: screenshot.

## Part D — Booth: card payments (Paystack TEST)

**D1. Success.** Booth: scan **T2** → **Check** → **Card**. The Paystack
checkout opens. Pay with the **success** test card (PIN/OTP from Paystack's page).
- **Should see**: the booth turns to "Paid".
- **Paste**: screenshot, and the payment reference from the portal's
  transaction detail for T2 (`QRP_...`).

**D2. The webhook arrived (droplet).**

```bash
cd /opt/qrpark
```

```bash
docker compose -f compose.prod.yml logs api --since 30m | grep -E "SUCCESS via (webhook|verify)"
```

- **Should see**: `Payment QRP_... SUCCESS via webhook; ticket <T2> PAID` for
  D1's reference. (`via verify` alone means the webhook did not arrive: check
  the webhook URL in qrpark's Paystack test business, and say so.)
- **Paste**: that line. In Paystack's dashboard (test mode) → the transaction →
  webhook delivery: paste a screenshot showing it was delivered (200).

**D3. A forged webhook is refused (PC).**

```powershell
try { (Invoke-WebRequest -UseBasicParsing -Method Post -Uri https://qrpark-api.gsds.com.ng/paystack/webhook -ContentType 'application/json' -Headers @{ 'x-paystack-signature' = ('0' * 128) } -Body '{"event":"charge.success","data":{"reference":"QRP_FORGED_TEST","amount":50000,"currency":"NGN"}}').StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
```

- **Should see**: `401`.
- Then on the droplet:

```bash
docker compose -f compose.prod.yml logs api --since 10m | grep -c QRP_FORGED_TEST
```

- **Should see**: `0` (nothing acted on it).
- **Paste**: both outputs.

**D4. Declined.** Make a new Car ticket **T4** at entry. Booth: scan T4 → Check
payment → Card → pay with the **declined** test card.
- **Should see**: Paystack shows the decline; then the booth shows "The card
  payment failed. Choose again: card or cash."; T4 stays Unpaid.
- **Paste**: screenshots.

**D5. Abandon, cancel after 60 s, retry.** Booth: scan **T3** → Check →
Card; when the checkout opens, **close it without paying**. Tap **Cancel
payment** at once.
- **Should see**: "Cancel is allowed from HH:MM" (60 seconds after the start).
- After that time, tap **Cancel payment** again → "Asking Paystack, then
  cancelling…" → "The card payment was not completed. Choose again: card or cash."
- Tap **Card** again and pay with the **success** card.
- **Should see**: "Paid".
- **Paste**: screenshots of the three messages. In the portal, the transaction
  detail of T3 shows one ABANDONED and one SUCCESS payment; the **Audit** view
  shows `PAYMENT_CANCELLED` for T3 with `booth-1`. Paste both.

## Part E — Exit

**E1.** Exit phone: scan **T1** → **Validate**.
- **Should see**: green "Valid — allow exit".

**E2.** Same phone, scan T1 → Validate again.
- **Should see**: "Already used — by you", with the time and gate.

**E3.** Exit phone: scan **T2** → Validate → "Valid — allow exit".
- **Paste**: screenshots of E1–E3.

**E4. No connection, no approval.** Exit phone: turn on **Airplane mode**; scan
**T3** (paid, not yet used) → Validate.
- **Should see**: "Cannot verify — no connection". Never "Valid".
- Turn Airplane mode off, Validate T3 again → "Valid — allow exit".
- **Paste**: both screenshots.

## Part F — EXPIRED (a ticket from an earlier day)

**F1. Droplet**: run the SQL of docs/07 step 15 exactly as written there (it
makes ticket `XPRD-TST3`, issued 24 hours ago).
- **Should see**: one row: `XPRD-TST3`, a token, `issued_at` a day ago,
  `valid_until` the end of that Lagos day.
- **Paste**: the ticket number and `valid_until` **only — not the token**.

**F2.** Put the token on a phone: type it into the booth's **Scan the ticket**
field (it is masked), or make a QR of it with an offline tool on
the PC. Do not put it in chat or in a shared file.

**F3.** Booth: scan it → **Check**.
- **Should see**: "Expired: issued on an earlier day. No payment is taken."
  and no Cash or Card choice.

**F4.** Exit: Validate it.
- **Should see**: "Expired".
- **Paste**: screenshots of F3 and F4.

## Part G — Sign-in throttle and the unthrottle command

**G1.** A spare phone (or the Entry phone after Sign out): sign in as `entry-1`
with a **wrong** password **5 times**, then once with the **right** one.
- **Should see**: the first five say "Invalid username or password"; the
  sixth, even with the right password, says "Too many sign-in attempts. Try
  again in N minutes."
- **Paste**: a screenshot of the sixth.

**G2. Droplet**: clear the block.

```bash
docker compose -f compose.prod.yml exec api node dist/unthrottle.js entry-1
```

- **Should see**: `Cleared N sign-in throttle count(s) for that username.`
- Then sign in as `entry-1` with the right password: it works.
- **Paste**: the command's output and a screenshot. In the portal **Audit**,
  one `LOGIN_THROTTLED` row: paste a screenshot.

## Part H — The Admin Portal and the CSVs

**H1. Dashboard** (today).
- **Should see**: tickets issued today matching parts B and D (T1–T4 plus any
  extra), revenue = the cash and card you took (₦500.00 each, TEST VALUES).

**H2. Transactions**: find T1 (search by its last 4 characters); open the
detail.
- **Should see**: its payment (CASH, reference, booth-1, time in Lagos), its
  scans (Check, the unpaid exit attempt, VALID, ALREADY_USED).

**H3. Finance** (today).
- **Should see**: cash ₦500.00 (T1) and card ₦1,000.00 (T2, T3) apart and in
  total; recorded cash for Test booth 1 / booth-1 = ₦500.00; nothing counted
  for T4's failed card or T3's abandoned one.

**H4. Incomplete sessions**: today in progress (T4: unpaid) and earlier days
never validated (XPRD-TST3).

**H5. Audit**: the cash confirmation, the cancel, the sign-in block, the seed
changes; no token, checkout link or Paystack payload anywhere.

**H6. Each CSV**: on Transactions, Incomplete, Finance and Audit, **Download
CSV** for today, and open each in Excel.
- **Should see**: it opens with no import step; amounts in naira as numbers;
  times are Lagos date-times; the payment reference column on Finance; the
  same rows as the page shows for the same day.
- **Paste**: a screenshot of each page and of each CSV open in Excel.

## Part S — Server checks (droplet)

**S1. Reboot test.**

```bash
sudo reboot
```

Wait two minutes, sign in again as `deploy`, then:

```bash
cd /opt/qrpark
```

```bash
docker compose -f compose.prod.yml ps -a
```

- **Should see**: caddy, api, portal, postgres, redis all `Up … (healthy)`;
  migrate `Exited (0)`.

```bash
systemctl list-timers qrpark-backup.timer --no-pager
```

- **Should see**: the timer listed with its next run (02:30 Lagos).

PC:

```powershell
Invoke-RestMethod https://qrpark-api.gsds.com.ng/health
```

- **Should see**: `status ok`, `database up`, `redis up`. Sign in to the portal
  and an app again: both work.
- **Paste**: the three outputs.

**S2. Redis: noeviction, and jobs do not pile up (closes L3).**

```bash
docker compose -f compose.prod.yml exec redis redis-cli CONFIG GET maxmemory
```

```bash
docker compose -f compose.prod.yml exec redis redis-cli CONFIG GET maxmemory-policy
```

```bash
docker compose -f compose.prod.yml exec redis redis-cli CONFIG GET appendonly
```

```bash
docker compose -f compose.prod.yml exec redis redis-cli ZCARD bull:qrpark-payments:completed
```

```bash
docker compose -f compose.prod.yml exec redis redis-cli ZCARD bull:qrpark-payments:failed
```

```bash
docker compose -f compose.prod.yml exec redis redis-cli INFO memory | grep -E "^used_memory_human|^maxmemory_human"
```

- **Should see**: `268435456`, `noeviction`, `yes`; completed jobs `0` (each
  is removed when it finishes) after part D's card payments; failed jobs 50 or
  fewer; memory used a few MB of 256 MB. (The Redis password is already in the
  container; nothing is typed.)
- **Paste**: all six outputs.

**S3. A forged X-Forwarded-For against the real Caddy, through the api and the
portal.** This makes two wrong sign-ins for `entry-1`, each sending a forged
address, and then asks Redis which address they were counted for. They must
be counted for **your PC's real public address**, never the forged one.

PC: save the request script (it sends the fixed wrong password
`wrong-password-123`; nothing secret):

```powershell
@'
const [mode, forged] = process.argv.slice(2);
const API = 'https://qrpark-api.gsds.com.ng', ADMIN = 'https://qrpark-admin.gsds.com.ng';
if (mode === 'api') {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': forged, 'x-real-ip': forged }, body: JSON.stringify({ username: 'entry-1', password: 'wrong-password-123' }) });
  console.log(`api: ${r.status} ${(await r.text()).slice(0, 120)}`);
} else {
  const html = await (await fetch(`${ADMIN}/login`)).text();
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const n = /name="([^"]*)"/.exec(m[0])?.[1]; const v = /value="([^"]*)"/.exec(m[0])?.[1] ?? '';
    if (n) fd.append(n, v.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  }
  fd.append('username', 'entry-1'); fd.append('password', 'wrong-password-123');
  const r = await fetch(`${ADMIN}/login`, { method: 'POST', headers: { origin: ADMIN, 'x-forwarded-for': forged, 'x-real-ip': forged }, body: fd, redirect: 'manual' });
  const t = await r.text();
  console.log(`portal: ${r.status} ${/(Username or password not recognised\.|Too many sign-in attempts[^<]*)/.exec(t)?.[1] ?? '(no message found)'}`);
}
'@ | Set-Content -Encoding utf8 "$env:TEMP\qrpark-xff.mjs"
```

```powershell
node "$env:TEMP\qrpark-xff.mjs" api 203.0.113.7
```

- **Should see**: `api: 401 {"message":"Invalid username or password",...}`

```powershell
node "$env:TEMP\qrpark-xff.mjs" portal 198.51.100.9
```

- **Should see**: `portal: 200 Username or password not recognised.`

Droplet (from an SSH session opened from the same PC, so `SSH_CLIENT` holds
your PC's public address): count the failures by address. The keys are hashes
made with the server's secret; this rebuilds them inside the api container and
prints only addresses and counts:

```bash
docker compose -f compose.prod.yml exec -T api node - "${SSH_CLIENT%% *}" 203.0.113.7 198.51.100.9 <<'JS'
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const Redis = require('/app/node_modules/ioredis');
const { throttleKeys } = require('/app/dist/auth/login-throttle.js');
(async () => {
  const prisma = new PrismaClient(); const redis = new Redis(process.env.REDIS_URL);
  const site = await prisma.site.findUnique({ where: { code: process.env.SITE_CODE } });
  for (const a of process.argv.slice(2)) {
    const k = throttleKeys(process.env.JWT_SECRET, site.id, 'entry-1', a);
    console.log(`address ${a}: failures for entry-1 from this address: ${(await redis.get(k.pair)) ?? '0'}`);
  }
  await redis.quit(); await prisma.$disconnect();
})();
JS
```

- **Should see**: your public address: `2`; `203.0.113.7`: `0`;
  `198.51.100.9`: `0`. (If your PC's address is `0` too, the SSH session and
  the PC requests went out by different networks: say so.)
- Then clear the two failures:

```bash
docker compose -f compose.prod.yml exec api node dist/unthrottle.js entry-1
```

- **Paste**: the two PC outputs and the droplet's three lines (your public
  address is fine to paste).

**S4. Backup and restore check.**

```bash
sudo systemctl start qrpark-backup.service
```

```bash
ls -l /var/backups/qrpark
```

- **Should see**: `-rw------- deploy deploy … qrpark-<UTC stamp>.dump`.

```bash
/opt/qrpark/deploy/restore-check.sh
```

- **Should see**: every table with the same count in `live` and `restored`, and
  `RESTORE CHECK: every table's row count matches` (run it when nobody is using
  the apps; a sale between the backup and the check shows as a difference).

```bash
journalctl -u qrpark-backup --since today --no-pager | tail -5
```

- **Paste**: the three outputs.

**S5. Log rotation in place** (from 6a):

```bash
docker inspect -f '{{.Name}} {{json .HostConfig.LogConfig}}' $(docker ps -aq)
```

- **Should see**: `json-file` with `"max-file":"3","max-size":"10m"` for every container.
- **Paste**: the output.

---

## After the run

Paste everything into the review room. Then, on the droplet, there is nothing
to clean up: the test tickets, payments and audit rows stay as the record of
the test (the site is a test site). The expired ticket `XPRD-TST3` stays too;
a later run needs another number (docs/07 step 15).
