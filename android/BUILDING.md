# Building the Android app

One app, one Gradle module (`android/app`). The release **build rules** live in
`android/build-logic`, an included build loaded by `android/settings.gradle.kts`;
it holds build logic only, no app code.

Adapted from eparking 359c0c1 `android/BUILDING.md`: one app instead of two,
`qrpark.*` property names, the debug and release APK tasks, and no vendor flavours.

Gradle 8.9 and **JDK 21** (the JetBrains Runtime 21 that ships with Android
Studio works; JBR 25 is too new for Gradle 8.9). There is no wrapper script;
run Gradle from Android Studio or with a local Gradle 8.9.

## Development builds

```bash
gradle -p android :app:testDebugUnitTest :app:debugApk
gradle -p android/build-logic test
```

`debugApk` builds the debug APK and writes, under `android/app/build/apk/`:

- `qrpark-<versionName>-debug.apk`
- `qrpark-<versionName>-debug.apk.sha256` (check it with `sha256sum -c`)

In the same step it deletes the previous debug APK and its `.sha256` from that
folder. Nothing else there is touched.

A debug build talks to `http://10.0.2.2:3000`, the host machine as seen from
the Android emulator, and may use cleartext to that address only:
`src/debug/res/xml/network_security_config.xml`. The main (release) config,
`src/main/res/xml/network_security_config.xml`, permits no cleartext at all.
`SourceRulesTest` checks both.

## Build properties

| Property | Meaning | Default |
|---|---|---|
| `qrpark.apiBaseUrl` | The backend the app talks to, baked in as `BuildConfig.API_BASE_URL` | `http://10.0.2.2:3000` |
| `qrpark.signing.storeFile` | Path to the release keystore | none |
| `qrpark.signing.storePassword` | Its password | none |
| `qrpark.signing.keyAlias` | The key's alias | none |
| `qrpark.signing.keyPassword` | The key's password | none |

Pass the address on the command line (`-Pqrpark.apiBaseUrl=https://…`). The
signing properties go in **your own** `~/.gradle/gradle.properties`, **never**
in the repo (see "The signing key" below).

## Version numbers

- `versionCode` = the number of commits on `HEAD` (`git rev-list --count
  HEAD`). A build with uncommitted changes is numbered as the next commit
  (count + 1), so it installs over every build before it.
- `versionName` = `<app version>-b<versionCode>-<short commit>`, for example
  `0.4.0-b7-1e1b858`; a build with uncommitted changes ends in `-dirty`.
  **Never hand out a `-dirty` build.**

## Release builds

```bash
gradle -p android :app:releaseApk -Pqrpark.apiBaseUrl=https://<your backend>
```

`releaseApk` builds the signed release and writes, under `android/app/build/apk/`:

- `qrpark-<versionName>-release.apk`
- `qrpark-<versionName>-release.apk.sha256` (check it with `sha256sum -c`)

In the same step it deletes the previous release APK and its `.sha256`.
Build release APKs from a clean, committed checkout: a `-dirty` name means
uncommitted changes went in.

Before any release build, `checkReleaseConfig` stops it, listing every
problem at once, when:

- the address is not `https://…` (the emulator default included);
- the clone is shallow or has no git history (the commit count would be
  wrong; fix with `git fetch --unshallow`);
- any of the four signing properties is missing, or the keystore file does
  not exist. **There is no fallback to the debug key**: without the
  properties no release signing exists at all.

A release build has no cleartext at all: its network config
(`src/main/res/xml/network_security_config.xml`) allows https only, and the
emulator exception lives in the debug source set. `SourceRulesTest` checks
both, and the Sprint 4c evidence shows it on a signed release APK with aapt2.

## The signing key (yours, made once, by hand)

**You make and keep this key yourself.** It is never in the repo, in chat or
in an email, and nobody else needs it. Every release build must be signed
with the same key: a device only accepts an update signed like the build
already installed. Lose the key and every device has to uninstall the app
(losing its sign-in) before a new build installs.

1. Create it outside the repo, in your user folder. keytool asks for the
   password; with PKCS12 the key password is the same. On Windows, with
   Android Studio's JDK:

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.qrpark-signing"
   & "$env:USERPROFILE\.jdks\jbr-21.0.11\bin\keytool.exe" -genkeypair -v `
     -keystore "$env:USERPROFILE\.qrpark-signing\qrpark-release.jks" `
     -storetype PKCS12 -alias qrpark-release `
     -keyalg RSA -keysize 4096 -validity 3650 `
     -dname "CN=QR Parking release builds, C=NG"
   ```

2. Put the four properties **only** in your own
   `C:\Users\<you>\.gradle\gradle.properties` (forward slashes in the path):

   ```properties
   qrpark.signing.storeFile=C:/Users/<you>/.qrpark-signing/qrpark-release.jks
   qrpark.signing.storePassword=<the password you typed>
   qrpark.signing.keyAlias=qrpark-release
   qrpark.signing.keyPassword=<the same password>
   ```

3. Back up the `.jks` file **and** its password together, somewhere safe and
   offline (for example a password-manager entry with the file attached).
   `*.jks`, `*.p12` and `*.keystore` are git-ignored as a safety net, not as
   the place to keep it.

4. Build with `releaseApk` (above) and keep the `.sha256` beside the APK.

## Running on the emulator

1. `docker compose up -d` (Postgres and Redis).
2. The backend, with background jobs on (they are on unless `DISABLE_JOBS=1`):
   `cd backend && npm run build && node --env-file=.env dist/main.js`.
3. The emulator: `emulator -avd Medium_Phone` (use `-no-snapshot` if a
   restored snapshot leaves the system half-started).
4. `adb install -r android/app/build/apk/qrpark-<versionName>-debug.apk`.

Sign in with a test account from the seed (`entry-1` for Entry mode). Test
passwords live only in your own `backend/.env`.
