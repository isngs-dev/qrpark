# MINO-1 — checks on the Nexgo Mino 1

Steps that can only be run on the device. Install the **nexgo** debug build
(`android/BUILDING.md`, "Nexgo devices"), pointed at the hosted test
environment (`-Pqrpark.apiBaseUrl=https://…`). Use TEST tickets only.
That APK embeds the Nexgo SDK: keep it private.

## D. Detection: by capability, never by model

- **D1.** On the Mino, sign in as an entry operator, create a ticket and tap
  Print. It must print on the **Nexgo printer**, with no Android print
  dialog. If the print dialog shows instead, the device's Nexgo service did
  not answer: note it.
- **D2.** Install the same nexgo APK on an ordinary Android phone. Print must
  open Android's print dialog, and Scan with camera the CameraX screen,
  exactly as the standard build does.

## P. Printing (entry operator)

- **P1.** The printed ticket matches the ticket screen:
  - the GSD logo left and the AIC logo right, the header lines;
  - one QR;
  - vehicle type, fee in naira, issue time, "Valid today only", ticket
    number, entry gate, and the footer.

  It is printed at **384 dots**. The SDK reports no paper width, so the app
  uses the 58 mm fallback. Compare with the probe's ruler reading for the
  Mino. If the Mino's paper is wider, tell us: the width is a single change
  in `NexgoTicketPrinter.paperWidthDots()`.
- **P2.** Scan the printed QR on Check: the screen shows the same ticket
  (ticket number) as the one created.
- **P3. Reprint.** Tickets list, the same ticket, Reprint, then Print.
  - The new print's QR scans to the **same ticket**.
  - In the Admin Portal: still one ticket and no payment from the reprint;
    the reprint is in the audit log.
- **P4. Out of paper.** Open the paper cover or run out of paper, then
  Print. The screen says "Printing failed. Tap Print to try again."; it
  never says "Sent". Then reload paper and print again.
- **P5. Double tap.** Tap Print twice quickly: exactly one ticket comes out.
- **P6.** The booth and exit screens have no Print button anywhere.

## S. Scanning (booth, exit and the entry Check)

- **S1.** At each screen, tap Scan with camera. The **Nexgo** scan screen
  opens; scan the printed ticket.
  - The field fills, and nothing happens until you tap Check (booth, entry)
    or the exit button.
  - The result matches a CameraX scan of the same ticket on an ordinary phone.
- **S2.** Close the Nexgo scan screen with its back button. You return to
  the screen with the field unchanged, and no camera screen opens.
- **S3.** Wait 60 s without scanning. You return to the screen, unchanged.
- **S4. Fallback.** If the Nexgo scanner ever reports an error, the CameraX
  scan screen must open instead. This cannot be forced by hand; note it if
  seen.
- **S5.** The exit still accepts only a PAID ticket: scan an unpaid TEST
  ticket at the exit and see "Payment required".

## L1. A ticket token never reaches the device log

**Why.** Our code never logs a token. That is tested in the JVM tests
(`SourceRulesTest`, the logging scan) and the APK guard forbids
`android.util.Log` in the Nexgo adapter. But the Nexgo SDK is vendor code: we
cannot see or change what it writes to the log. Only a run on the device can
show it.

**Setup.**
- A **TEST** ticket from the hosted test environment, with TEST VALUE prices.
  Never a live ticket.
- The Mino 1 connected by USB with USB debugging on, and the `nexgo` debug
  build installed.
- Write the ticket's token down **only on the PC running the check**, in a
  shell variable. Never in a file in the repo, the evidence or a screenshot.

**Steps.**

1. Clear the log:
   ```bash
   adb logcat -c
   ```
2. On the Mino, sign in as an **entry** operator, create a TEST ticket and
   print it on the Nexgo printer. Then reprint it once.
3. Sign in as an **exit** operator. Scan the printed ticket once with **Scan
   with the Nexgo scanner** and once with **Scan with camera** (CameraX).
   Tap Check each time.
4. As a **booth** operator, scan it once with each scanner and tap Check.
5. Save the whole log to a temporary file **outside the repo**:
   ```bash
   adb logcat -d -v threadtime > "$TMP/mino1-logcat.txt"
   ```
6. Search it, with the token held only in the shell (`TOKEN=...`). Search for
   the whole token and for its first and last 12 characters. That catches a
   token cut short, or split across log lines:
   ```bash
   grep -c -F "$TOKEN" "$TMP/mino1-logcat.txt"
   grep -c -F "${TOKEN:0:12}" "$TMP/mino1-logcat.txt"
   grep -c -F "${TOKEN: -12}" "$TMP/mino1-logcat.txt"
   ```
7. For any non-zero count, find which process wrote the line **without
   printing the line itself**. Field 3 of the threadtime format is the
   process id:
   ```bash
   grep -F "${TOKEN:0:12}" "$TMP/mino1-logcat.txt" | awk '{print $3, $5, $6}' | sort | uniq -c
   adb shell ps -A -o PID,NAME | grep -E '<pid>'
   ```
8. Delete the temporary log and unset `TOKEN`. Leave the TEST ticket unpaid:
   it expires at the end of the day.

**Record** (in `.evidence/MINO-1.txt`; counts and process names only, never a
log line that holds the token):
- the counts from step 6;
- for any hit, the process, the log tag, and whether it came from our app's
  process (`ng.gsds.qrpark`) or another (Nexgo's service, the system).

**Pass.** All counts are 0.

**If our app's process logged it**, that is a defect in our code or in
the SDK code running inside our process. The run fails. Find the call and
fix it before MINO-1 is accepted.

**If the Nexgo SDK logs the scanned text**, whether inside our process or in
Nexgo's service, we cannot change that code. The mitigation, in order:

1. **Stop using the Nexgo scanner** for tickets. Turn the Nexgo scan adapter
   off and scan with CameraX (with zxing, which logs nothing), as on every
   other phone. The printer is unaffected: it receives the ticket as one
   image, never the token as text, so it cannot log the token.
2. Report it to Nexgo, with the tag and process, but not the token.
3. Note the facts in `docs/05-known-issues.md`. On a production device the
   log is readable only over adb (USB debugging) or by system apps. So USB
   debugging must be **off** on production Minos, and the go-live checklist
   (`docs/08`) gains that line.

The same check, run with the `standard` build on an ordinary phone, gives the
baseline: all zeros expected.
