# Nexgo N86 and its Android SDK — investigation N86-0

Status: **investigation only**. No app code was written or changed. The SDK
was treated as an untrusted vendor download: unpacked into a separate folder
outside every repository (`C:\Dev\nexgo-sdk-review`), nothing from it was
installed or run, and neither the SDK nor its password is in this repository.
Everything below is a summary in our own words; nothing here has been tried on
a real N86.

What was reviewed: the archive `Nexgo_Android_SDK_v3.08.016.zip` (SHA-256
`2564923c2e44a5592acc769e8d7e41d96f754b30235f0ce9feb60e6bacb21046`): the SDK
library `nexgo-smartpos-sdk-v3.08.016_20261110.aar`, its change log, the API
reference (324 pages), an FAQ, a development guide, a signing guide, two N86
firmware/package install sheets, the cloud-management (TMS) manuals, a
prebuilt sample APK, Kotlin sample source, a vending-machine (MDB) SDK and a
payment demo project.

Each statement below is marked **[doc]** (vendor documentation says so),
**[inspected]** (seen in the files themselves), or **unknown**.

---

## Summary

1. The SDK covers the **printer**, a **camera scanner**, **card readers**
   (chip, contactless, magstripe, PSAM, Mifare and other memory cards), a
   **PIN pad** with key management, **EMV level 2 kernels**, LEDs, the beeper,
   serial ports and many **system controls** (silent install, reboot, clock,
   disabling the home and power buttons). It works by binding to a Nexgo
   **system service already on the terminal** [inspected].
2. **Whether a sideloaded app can run depends on the device's mode** [doc]. A
   **DEBUG-mode** N86 accepts any APK and adb installs, like a phone. A
   **RELEASE-mode** N86 installs only APKs that also carry **Nexgo's own
   signature**, made in Nexgo's online signing system with a customer
   certificate that is also installed on the device; adb or Android Studio
   installs are refused. **Which mode our N86 is in is unknown.**
3. **Security**: no Java networking code and no IP addresses in the SDK; no
   private keys or credentials in it; the web addresses found are standard
   NFC prefixes, SVG namespaces and one certificate-revocation address inside
   an embedded certificate [inspected]. One native library (remote key
   loading) contains a TLS client and network functions; it would only run if
   the app called the remote-key-loading API, which we would not. The SDK's
   **system controls are powerful** and must never be called by our app.
4. **Card payments**: the SDK **reads cards and runs EMV, but does not
   process payments**. It has no acquirer or host connection: at the online
   step it hands the card data to the app, which must send it to a payment
   host itself [doc]. Taking real card payments on the N86's reader would need
   an acquirer or processor, key injection and certification — **none of
   which we have, and none of which is needed for our current Paystack
   checkout**.
5. **Proposal**: use the N86 **printer** behind our existing `TicketPrinter`
   seam, chosen when the device offers the Nexgo print service; keep scanning
   on **CameraX** (works on any Android camera) and keyboard-wedge input; keep
   **card payment on the Paystack checkout**; prove the hardware first with a
   small, separate **probe app** that has no network access.

---

## 1. What the SDK provides

**Packaging** [inspected]

- One Android library, `nexgo-smartpos-sdk-v3.08.016_20261110.aar` (about
  6 MB): Java classes (about 700, mostly `com.nexgo.oaf.apiv3`), four helper
  libraries (a client for the terminal's system service, a barcode decoder,
  an NFC tag-message library and a TR-34 remote-key-loading library), and
  **native libraries for 32- and 64-bit ARM only** (no x86: it cannot run on
  the Android emulator).
- Its manifest declares **no permissions, services or components**; minimum
  Android 4.4 (API 19), target API 25. The 3.x sample app targets API 34 with
  minimum API 24 and declares only storage permissions.
- Integration: copy the AAR into the app, add it as a dependency, get a
  `DeviceEngine` from the SDK, then get each module from it (printer, scanner,
  card reader, PIN pad, EMV, LED, beeper, platform) [doc].
- Hardware access goes through a Nexgo **system service** on the terminal
  (the SDK binds to `com.xgd.possystemservice` and related services; the
  scanner can use a separate camera-decode service) [inspected].

**Printer** [doc]

- Initialise, read the status (out of paper, overheating, busy, not finished,
  fault), add **text** (four sizes, left/centre/right, bold), add a **bitmap**
  (aligned), add a **barcode** or a **QR code** (height, optional version and
  error-correction level), set grey level, typeface, line spacing, invert,
  feed or cut, then **start printing**; the result arrives in a print
  listener. Errors include out of paper, overheating, busy, font missing and
  "packet too long".
- **Paper width in dots is not stated anywhere in the SDK: unknown.** The
  sample prints a logo bitmap without scaling it.

**Scanner** [doc]

- **Camera-based**: front or back camera, single or continuous scanning,
  auto-focus, a list of symbologies, Nexgo's own scan screen (configurable
  title, buttons, tips) or a fully custom screen with your own preview
  surface; also a call that decodes a raw camera frame.
- Results arrive in a callback as **text** with a result code (success, fail,
  timeout, user exit). Nothing in the SDK describes a separate laser or
  imager scan engine; **whether the N86 has one is unknown** (if it does and
  it acts as a keyboard, our existing typing support would take it).

**Card readers** [doc]

- One "search card" call watches the chosen slots: **chip (contact)**,
  **contactless (RF/NFC)**, **magstripe**, PSAM slots; plus APIs for CPU
  cards, Mifare Classic, DESFire, Ultralight, NTAG, memory cards and ISO 15693
  tags, and card emulation (on some models).

**PIN pad and keys** [doc]

- On-screen PIN entry (also a "blind" PIN pad with audio prompts), external
  PIN pads, PIN-block and MAC calculation, data encryption.
- Key management: master/session keys, **DUKPT** (DES and AES), **TR-31** key
  blocks, key injection calls, and **TR-34 remote key loading** where the
  platform supports it. Optional **P2PE** (point-to-point encryption) of card
  data, with an app-whitelist check [inspected].

**EMV** [doc]

- EMV level 2 processing for contact and contactless, with kernels for Visa
  payWave, Mastercard PayPass, Amex ExpressPay, Discover/DPAS, JCB, UnionPay,
  RuPay, Interac, Mir, Pure, Bancomat and others; AID and CAPK management;
  callbacks for amount, application selection, PIN, online authorisation and
  completion.

**Other** [doc]

- LEDs (red, green, yellow, blue), the beeper, serial and USB serial ports,
  GPIO (some models), device information (serial number, model, OS, SDK,
  firmware and EMV kernel versions, secure-chip versions).
- **Platform (system) controls**: install and uninstall apps silently, update
  firmware, reboot or shut down, mobile data, roaming and airplane mode,
  enable or disable the home, task and power buttons and the status and
  navigation bars, set the system clock, force-stop apps, grant log access.

**Android versions and device** [doc]

- The API reference was written for the N5 (Android 5.1.1) and says little
  about the N86. The change log records N86 support ("compatible with N86",
  N86 EMV and DPAS kernel updates, N86 Pro). The FAQ shows the N86 sits on a
  base and can be debugged over Wi-Fi ADB after enabling it over USB.
- **The N86's Android version, screen, camera, printer and paper width are
  not stated in this SDK: unknown** until checked on the device or confirmed
  by Nexgo.

**Documentation and demos in the package**: the API reference; an FAQ
(firmware, ADB, signing, launcher, silent install, EMV tips, printer quality);
a development guide (debug versus release devices, signing, certificate
installation); the online signing guide; N86 firmware and package install
sheets (USB stick or cable); manuals for Nexgo's cloud device management
(TMS); a prebuilt sample APK and Kotlin sample source covering printer, card
reader, EMV, PIN pad, DUKPT, TR-31, serial and platform; a vending-machine
(MDB) SDK; and a payment demo project. None of it was installed or run.

## 2. Can a normal sideloaded app run on the N86?

**It depends on the device's mode** [doc]:

| Device mode | What installs | How |
|---|---|---|
| **DEBUG** | Any APK, unsigned by Nexgo | adb / Android Studio over USB, or a file manager; behaves like an ordinary Android device. Not for production. |
| **RELEASE** | Only APKs that carry **both** a normal Android signature **and Nexgo's signature** | Upload the APK to Nexgo's online signing system (an account issued by Nexgo), choose the model, download the signed APK, install it from the device's file manager. adb and Android Studio installs are refused. |

- Nexgo's signature is separate from Android's own: our own release keystore
  stays ours; Nexgo appends theirs (the guide recommends their "V2" mode,
  which leaves our signature untouched). The device must also have **our
  customer certificate** installed (Settings → Security → SmartPOS Trusted
  credentials), issued by Nexgo for our company.
- **Enabling adb** [doc]: on a device that allows it, Settings → Developer
  options → USB debugging, as on a phone. For the N86 on its base, connect it
  by USB first, run `adb tcpip 5555`, then reconnect over Wi-Fi. Some Nexgo
  models need a special firmware for Wi-Fi ADB from Nexgo support.
- **Unknown** until checked: our N86's mode; whether Developer options and
  "install unknown apps" are available; whether it is locked to a vendor
  launcher; whether Nexgo will switch it to DEBUG mode or issue us a signing
  account and certificate.

## 3. Security review of the SDK

How it was reviewed: the archives were listed before extraction (no unsafe
paths, no links, size checked) and extracted with Python's standard library
into a separate folder; manifests were read as text or with Android's `aapt2`;
class files and native libraries were scanned **as bytes** for addresses,
API names and key-like data; native libraries' imported function names were
listed. Nothing was executed. **Note:** the SDK's licence forbids decompiling,
disassembling or reverse engineering; the review stayed with listings, string
and symbol scans and one listing of a class's method names (no code), and went
no further.

| Check | Finding |
|---|---|
| Permissions | The AAR's manifest requests **none**. The code refers to 16 Nexgo-specific `CLOUDPOS_*` permission names (printer, PIN pad, EMV, keys…) and `READ_LOGS`; the sample app declares none of them. How these are granted on a release device is **unknown** (likely through Nexgo signing). |
| System service | The SDK binds to Nexgo's on-device system service and AIDL interfaces for app install/delete, device, system, network, TMS (remote management) and UI control [inspected]. |
| Native libraries | 26 per ABI: EMV kernels, card libraries, a code generator, an NFC tag library, TR-34. Imported functions: **no network functions** except in `libtr34.so`; `libnexgo_sdkemvjni.so` uses `popen`/`dlopen` to read the device model (`getprop ro.product.model`) and create folders [inspected]. |
| Network / phone-home | **No Java networking classes and no IP addresses** in the SDK's classes. `libtr34.so` contains the **mbedTLS** library with a TLS client and socket/DNS functions: used for **remote key loading** from a key host, only when the app calls TR-34 APIs (we would not). Addresses found: NFC URI prefixes (`http://www.`, `ftp://…`, used to encode tag contents), SVG namespaces, a toolchain URL, and a **CRL address of Nexgo's PKI** inside an embedded certificate [inspected]. Device management (TMS/cloud) is a separate Nexgo system app on the terminal, not this SDK; what it reports to Nexgo's cloud is **unknown**. |
| Device identifiers | No IMEI, SIM, phone-number, account, location or contact access found. One `getDeviceId` is the USB serial driver's device id [inspected]. Device info returns the terminal serial number to the app. |
| Credentials and keys | **No private keys or credentials** found: the PEM headers in `libtr34.so` are library strings with no key data; two embedded DER **certificates** (public) belong to the key-loading PKI; the one long hex value in Java code is all zeros (a default). Other long hex strings sit in EMV and crypto libraries (constants, for example public CA keys or curve parameters) [inspected]. The package does not ask for any key or credential to use the printer or scanner [doc]. |
| Dynamic code | Reflection and `loadLibrary` for its own native libraries; no dex loading from outside found [inspected]. |
| Suspicious | Nothing that looks hostile. **Powerful by design**: any app using the SDK can silently install or uninstall apps, update firmware, reboot, change the clock, disable buttons and network, read logs. On a DEBUG-mode device any app could do so. Our app must never call these (see section 5). |
| Build artefacts | Developer paths of the vendor's build machine are embedded in a native library (harmless, shows the TR-34 library was built for another model and a FutureX HSM key-loading scheme). |

## 4. Card payments: what the SDK does and does not do

**Does** [doc]:

- Detect and read cards (chip, contactless, magstripe).
- Run the **EMV level 2** transaction on the card with the built-in kernels.
- Take a **PIN** on the secure PIN pad and produce an encrypted PIN block with
  keys held in the terminal's secure module.
- Manage keys (master/session, DUKPT, TR-31, remote loading via TR-34) and
  optionally encrypt card data (P2PE).

**Does not** [doc]:

- **Connect to any acquirer, processor or payment host.** When EMV needs
  online authorisation, the SDK calls the app (`onOnlineProc`); the app must
  take the card data, build its own message, send it to a host, and pass the
  host's answer back. The included payment demo connects to a host of its
  own; no host is part of the SDK.
- Settle, reconcile, refund or report payments; hold a merchant account.

**What real card payments on the N86's reader would need** (outside the SDK):

- An **acquirer or processor** that accepts transactions from this terminal,
  and its host specification (message format, connection, security).
- **Key injection**: payment keys loaded into the terminal's secure module by
  a key-injection facility or by remote key loading — arranged with the
  acquirer. **Unknown** for Nigeria and for Paystack.
- **Certification**: EMV level 3 certification per card scheme through the
  acquirer, and the terminal's own PCI PTS and EMV level 1/2 approvals (Nexgo
  provides those for the device; which are valid for the N86 is **unknown**).
- **Whether Paystack supports the N86 as a card-present terminal is unknown**
  (Paystack's own terminal is a different device).

**For QR Parking today**: none of this is needed. Card payment stays on the
**Paystack checkout**, which runs in the app on any Android device, the N86
included: the customer types their card on Paystack's page, and the server
confirms it with Paystack. The N86's card reader would stay unused.

## 5. Design proposal (no code)

All locked rules stay: the scan only fills the ticket field and staff tap to
act; the ticket printed is the existing ticket (GSD logo left, AIC logo
right, the site's name and contact line, the QR holding only the opaque token,
never "E-Parking"); card payments only through the Paystack checkout; no
device model names, serial numbers or device lists in code; choices made by
what the device can do.

**Printer** — a new adapter behind the existing `TicketPrinter` interface:

- Chosen **by capability**: the Nexgo print service answers (the SDK returns
  a printer and its status reads correctly). Otherwise Android printing, as
  today; otherwise "no printer", as today.
- Prints the **same `TicketPaper`**, rendered to one black-and-white bitmap
  at the printer's width (measured with the probe app), then sent as an image,
  so the layout matches the PDF and the QR is drawn by our own code exactly as
  today. (The SDK's own QR call is not needed; using one rendering path keeps
  "the same QR" provable.)
- Reports out of paper, overheating, busy and fault in plain words; never
  marks a ticket as printed unless the print listener says so. Reprint is the
  existing reprint.

**Scanner**:

- Keep **CameraX** (our `ScanActivity`): it works on any Android camera,
  including the N86's, and is already tested. Keyboard-wedge input already
  works through the scan field.
- Add the SDK scanner **only if** the probe shows CameraX performs poorly on
  the N86, as another capability-chosen option feeding the same in-memory
  hand-off (`ScanHand`): the text fills the field and nothing else. The
  scanned text is never logged, stored or put in an Intent, as today.

**The SDK in the build**:

- The AAR is a **new dependency** (6 MB plus native libraries; ARM only).
  It needs your decision before it goes in, including **where it may be kept**
  (the licence restricts copying and transfer; ask Nexgo whether a private
  repository and CI may hold it).
- Our app would use **only** the printer (and, if needed, the scanner) and
  device-information calls. A test would check that no platform/system
  control, PIN pad, card reader, EMV or key API is referenced from our code.
- The SDK is ARM-only, so emulator builds must keep working without it
  (the capability check simply finds no Nexgo service).

**Card payment**: unchanged — the Paystack checkout. The N86 card reader is
not used.

**The hardware probe app** (a separate small app, not the production app):

- Its own package name (for example `ng.gsds.qrpark.probe`), its own folder,
  debug-signed for a DEBUG-mode device (or Nexgo-signed for a RELEASE-mode
  one); **no INTERNET permission**, so it cannot send anything anywhere.
- **Device info**: Android version and API level, build fingerprint, screen
  size and density, cameras, whether the Nexgo service answers, SDK and
  firmware versions, printer status. Shown on screen only.
- **Print tests**: a ruler (marks every 8 dots) to measure the paper width;
  black-and-white test bitmaps at 384 and 576 dots to see what fits; the
  **test ticket**: GSD and AIC logos, sample text and a QR of a random test
  value that is not a real ticket token; paper-out and printer-error handling
  shown on screen.
- **Scan tests**: CameraX scan, the SDK camera scanner, and a typing field for
  any hardware or keyboard-wedge scanner; each shows the decoded text on
  screen (test codes only) and the time taken.
- No card reader, PIN pad, EMV, key or platform calls at all.
- Built only after your go-ahead; its results (photos of the prints, screen
  captures) decide whether the production adapter is worth building.
- **Built in N86-1**: see [probe-app.md](probe-app.md) for what was built,
  how it differs from this proposal, and what each screen proves.

## 6. Questions and device checks

**Questions for Nexgo or the supplier**

1. Is our N86 in **DEBUG or RELEASE** mode? Can it be switched to DEBUG for
   development, and back?
2. For RELEASE devices: how do we get a **Nexgo signing account** and our
   **customer certificate**? Cost, turnaround, and whether every update needs
   re-signing.
3. Which **Android version** and security patch level does our N86 run, and
   is there a firmware update?
4. N86 **printer**: paper width in dots, dots per mm, maximum bitmap height,
   supported paper rolls.
5. N86 **scanner**: camera only, or a dedicated scan engine? Does any scanner
   act as a keyboard (wedge)?
6. May the **SDK library** be kept in our private source repository and built
   by our CI? May we distribute apps that include it to our own devices?
7. Is the SDK's printer/scanner usable **without** the `CLOUDPOS_*`
   permissions on a release device? How are those granted?
8. What does the device's **cloud management (TMS)** app report to Nexgo, and
   can it be turned off or pointed elsewhere?
9. Is the N86 approved for **card-present** payments in Nigeria with any
   acquirer, and does **Paystack** support it? (For later; not needed now.)
10. The FAQ mentions a "credit card lock" on old firmware (120 transactions an
    hour): does it affect anything other than card reading?

**Checks on the physical device**

- Settings → About: Android version, security patch, build number; model and
  serial (keep the serial off any shared document).
- Developer options: can they be turned on? USB debugging? Does `adb devices`
  see it over USB?
- Settings → Apps / Security: is "install unknown apps" allowed? Try
  installing a harmless APK from the file manager.
- Settings → Security → SmartPOS Trusted credentials: which certificates are
  installed (a sign of RELEASE mode and of whose apps it accepts)?
- Is it locked to a vendor launcher or kiosk mode? Can the home and recent
  buttons leave the vendor app?
- Cameras (front/back), screen size, printer paper loaded, battery and base.
- Which Nexgo apps are pre-installed (system service, TMS/cloud app)?
