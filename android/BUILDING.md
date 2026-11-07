# Building the Android app

One app, one Gradle module (`android/app`). The release **build rules** live in
`android/build-logic`, an included build loaded by `android/settings.gradle.kts`;
it holds build logic only, no app code.

Adapted from eparking 359c0c1 `android/BUILDING.md`: one app instead of two,
`qrpark.*` property names, the debug APK task, and no vendor flavours.

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
in the repo. Release signing and its steps arrive in Sprint 4c.

## Version numbers

- `versionCode` = the number of commits on `HEAD` (`git rev-list --count
  HEAD`). A build with uncommitted changes is numbered as the next commit
  (count + 1), so it installs over every build before it.
- `versionName` = `<app version>-b<versionCode>-<short commit>`, for example
  `0.4.0-b7-1e1b858`; a build with uncommitted changes ends in `-dirty`.
  **Never hand out a `-dirty` build.**

## Release builds (Sprint 4c)

Before any release build, `checkReleaseConfig` stops it, listing every
problem at once, when the address is not `https://…` (the emulator default
included), the clone is shallow or has no git history, or a signing property
is missing or the keystore file does not exist. There is no fallback to the
debug key.

## Running on the emulator

1. `docker compose up -d` (Postgres and Redis).
2. The backend, with background jobs on (they are on unless `DISABLE_JOBS=1`):
   `cd backend && npm run build && node --env-file=.env dist/main.js`.
3. The emulator: `emulator -avd Medium_Phone` (use `-no-snapshot` if a
   restored snapshot leaves the system half-started).
4. `adb install -r android/app/build/apk/qrpark-<versionName>-debug.apk`.

Sign in with a test account from the seed (`entry-1` for Entry mode). Test
passwords live only in your own `backend/.env`.
