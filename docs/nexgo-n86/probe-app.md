# N86 hardware probe app — N86-1

A separate test app for the Nexgo N86. It answers the hardware questions in
[investigation.md](investigation.md) (section 5) before any qrpark code is
written for the terminal. It is **not** part of qrpark: it lives in its own
folder, `C:\Dev\qrpark-n86-probe`, with its own local git. Its README has the
full build and install steps.

## Rules it follows

- **Its own project, outside this repository.**
  - Package `ng.gsds.qrpark.n86probe`.
  - Debug-signed. There is no release build.
- **The Nexgo SDK is never copied or committed.**
  - The probe's build reads the `.aar` from a path in its git-ignored
    `local.properties`.
  - The build refuses a path inside the probe's own folder.
- **No `INTERNET` permission.** The only permission is `CAMERA`.
- **No card, PIN, EMV, key-loading or system-control call.** System control
  means install, reboot, clock, buttons and settings.
- **The APK guard proves it.** Every build ends with a scan of the built APK
  itself, both its dex code and its permissions, and fails if:
  - our code refers to any SDK member outside a short allow-list (device
    info, printer, camera scanner);
  - our code refers to anything in the forbidden categories: card, PIN, EMV,
    key, system, process exec and reflection, network, logging;
  - a library touches the SDK;
  - any permission other than the camera appears.

  Only an APK that passes is copied out for installing, with its `.sha256`.
- **minSdk is set at build time** with `-Pprobe.minSdk=NN` (21–34, default
  29), for when the N86's Android version is known.
- **Nothing read is logged or stored.** Scanned text is shown only when it is
  the probe's own test value. Anything else, such as a real qrpark ticket, is
  shown as its length only.

## Screens and what each proves

| Screen | Shows | Proves |
|---|---|---|
| 1. Device info | Android version, API level, patch, build type, CPU, screen, cameras, developer access, who installed the APK; the SDK's device info and whether its service answers | The Android version (for minSdk), whether a sideloaded APK runs, whether the SDK binds on this device, which cameras exist |
| 2. Printer test | Two rulers (384 and 576 dots, a tick per 8 dots = 1 mm at 203 dpi), fine stripes and a chequerboard, a solid band, digits at each font size; every return code; "PRINTED" only on the printer's own success callback | The paper's printable width, whether images print dot for dot, darkness, characters per line, the printer's error codes |
| 3. Test ticket | qrpark's ticket layout (GSD logo left, AIC logo right, header, QR, lines) drawn as one image at 384 or 576 dots; the QR holds the fixed dummy value `N86-PROBE-TEST-NOT-A-TICKET`; every line says TEST | That the proposed adapter (render the ticket ourselves, print one image) works: both logos, the naira sign, and a QR that reads back |
| 4. Scanning | CameraX + zxing (as qrpark today), the SDK's camera scanner, and a typing field for keyboard-wedge scanners; result and time for each; a read never acts by itself | Whether qrpark's current camera scan is enough on the N86, whether the SDK scanner is better, whether a hardware scanner types into a field |

## Changed from the proposal in investigation.md section 5

- **The package name** is `ng.gsds.qrpark.n86probe`.
- **The QR value is fixed, not random.** That lets the scan screen recognise
  its own test ticket and say MATCH.
- **Scanned text is shown only for the probe's test values**, rather than for
  "test codes only" in general. A real ticket's token is never put on screen.

## Verified so far (no N86 yet)

The full raw output is in `.evidence/N86-1.txt`.

- The guard's rule tests: 6 pass.
- The APK guard on the real build passes.
- **Fail-when-removed, 1:** adding 16 forbidden references failed the build.
  Each was named, and no APK was published. The 16:
  - CARD, PIN and EMV;
  - KEY (HSM, KSN);
  - SYSTEM (Platform, reboot, install, clock);
  - a non-allow-listed beeper;
  - exec, log and network.
- **Fail-when-removed, 2:** adding `INTERNET` to the manifest failed the
  build. Restoring the file passes again.
- `probe.minSdk` takes 25 and refuses 99. The release build does not exist.
- On the Android emulator, the screens render and the camera and typing
  paths work. The SDK parts say "not available here", as expected: no Nexgo
  service, and its native code is ARM-only.

## The N86's Android version: 9 (API 28)

Reported from the device: the minSdk 29 build would not install ("problem
parsing the package"). The probe is therefore also built with minSdk 26
(Android 8.0 and later) and published beside the first, through the same
APK guard:

| Published APK | minSdk | For |
|---|---|---|
| `qrpark-n86-probe-api26-debug.apk` (+ `.sha256`) | 26 | **the N86** |
| `qrpark-n86-probe-debug.apk` (+ `.sha256`) | 29 | Android 10+ phones |

The probe's only call above API 26 (who installed the APK, API 30) already
sits behind a version check. The api26 build has not yet run on Android 8 or
9: this PC has only an Android 17 emulator image.

**For qrpark itself (a decision, not made here):** the production app's
minSdk is 29, so it cannot install on the N86 either. Running qrpark on the
N86 would mean lowering its minSdk to 28 or below, and checking every newer
API it uses.

## Still unknown (needs the N86)

Everything the probe exists to measure:
- the device's mode (DEBUG or RELEASE), and so whether the APK installs;
- the paper width;
- print quality;
- whether the SDK printer and scanner answer at all;
- which scan method works best.
