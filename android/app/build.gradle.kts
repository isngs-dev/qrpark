import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("qrpark.release")
    id("qrpark.apkguard")
}

// MINO-1: the Nexgo SDK (.aar) is NEVER in the repo. Its path comes from
// local.properties (git-ignored) or -Pnexgo.aar=..., and must lie outside the
// repo. Without it only the `standard` flavour exists, and that is what CI
// builds. See android/BUILDING.md, "Nexgo devices".
val localProps = Properties().apply {
    rootProject.file("local.properties").takeIf { it.isFile }?.reader()?.use { load(it) }
}
val nexgoAar: File? = (providers.gradleProperty("nexgo.aar").orNull ?: localProps.getProperty("nexgo.aar"))
    ?.takeIf { it.isNotBlank() }?.let { File(it) }
if (nexgoAar != null) {
    if (!nexgoAar.isFile) throw GradleException("nexgo.aar is set but does not point to a file.")
    val repo = rootProject.projectDir.parentFile.canonicalPath + File.separator
    if (nexgoAar.canonicalPath.startsWith(repo)) {
        throw GradleException("nexgo.aar must lie outside the repository; the SDK is never kept in it.")
    }
}

// Version, server address and the APK name come from android/build-logic,
// where the rules are tested. See android/BUILDING.md.
val release = the<ng.gsds.qrpark.release.QrparkReleaseExtension>().apply {
    baseVersion = "0.4.0"
}

android {
    namespace = "ng.gsds.qrpark"
    // 35 is the highest AGP 8.7.3 accepts.
    compileSdk = 35

    defaultConfig {
        applicationId = "ng.gsds.qrpark"
        // Android 10 (API 29) and up.
        minSdk = 29
        targetSdk = 35
        // The commit count: it rises with every commit, so every build
        // installs over the one before it.
        versionCode = release.versionCode
        versionName = release.versionName

        // Infrastructure only. Categories, prices and every operational
        // setting come from the backend, never from the build.
        // -Pqrpark.apiBaseUrl=https://... for a server; the default is the
        // emulator's view of this machine. A release build refuses anything
        // but https (checkReleaseConfig).
        buildConfigField("String", "API_BASE_URL", "\"${release.apiBaseUrl}\"")
    }

    // Release signing from the user's OWN ~/.gradle/gradle.properties, never
    // the repo (android/BUILDING.md). When it is missing, no release signing
    // config exists at all - nothing falls back to the debug key - and
    // checkReleaseConfig stops the build and names what is missing.
    // Copied from eparking 359c0c1 android/pos/app/build.gradle.kts (the
    // signingConfigs block), with this app's property names.
    signingConfigs {
        if (release.hasSigning()) {
            create("release") {
                val p = release.signingProperties()
                storeFile = file(p.getValue(ng.gsds.qrpark.release.SigningKeys.STORE_FILE)!!)
                storePassword = p.getValue(ng.gsds.qrpark.release.SigningKeys.STORE_PASSWORD)
                keyAlias = p.getValue(ng.gsds.qrpark.release.SigningKeys.KEY_ALIAS)
                keyPassword = p.getValue(ng.gsds.qrpark.release.SigningKeys.KEY_PASSWORD)
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            // No shrinking: what was tested is what ships.
            isMinifyEnabled = false
        }
    }

    // MINO-1. `standard`: every phone, no vendor code at all (the APK guard
    // checks it holds no vendor class). `nexgo`: the same app plus the Nexgo
    // printer and scanner adapters (src/nexgo), used only when the device's
    // Nexgo service answers; on any other phone it behaves as `standard`.
    // Same applicationId: one app, two builds.
    flavorDimensions += "device"
    productFlavors {
        create("standard") { dimension = "device" }
        create("nexgo") { dimension = "device" }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Theme, buttons, cards and text fields (Material 3).
    implementation("com.google.android.material:material:1.12.0")

    // The QR on the ticket, drawn from the token. The pure-Java core artifact
    // only: no camera bindings, nothing else pulled in.
    implementation("com.google.zxing:core:3.5.3")

    // Booth (Sprint 4b): the camera scan. CameraX 1.3.4, four artifacts of one
    // library (core, the camera2 backend, the lifecycle binding, PreviewView),
    // as eparking 359c0c1 android/pos uses. The QR is decoded by zxing core
    // (QrDecoder.kt). Deliberately NOT ML Kit, which needs Google Play Services.
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    // MINO-1: the Nexgo SDK, by path, for the nexgo flavour only (see the top).
    if (nexgoAar != null) add("nexgoImplementation", files(nexgoAar))

    // JVM unit tests for the pure rule files (no Android imports), so they
    // run in seconds with no emulator and no backend.
    testImplementation("junit:junit:4.13.2")
}

// Some tests read source files (the logging scan, the network config and the
// money rule), so editing them reruns the tests instead of reusing a pass.
tasks.withType<Test>().configureEach {
    inputs.dir("src/main")
    inputs.dir("src/debug")
    inputs.dir("src/standard")
    inputs.dir("src/nexgo")
}

// Without the SDK the nexgo variants do not exist, so a build without it
// succeeds and builds the standard app only.
androidComponents {
    beforeVariants(selector().withFlavor("device" to "nexgo")) { it.enable = nexgoAar != null }
}

// The APK guard (android/build-logic, ApkGuard*.kt): after every assemble, the
// built APK is scanned. standard: no vendor class at all. nexgo: our code may
// touch only the SDK's printer, scanner and device-info parts; nothing that
// reads cards, PINs, EMV or keys, controls the system, or reads logs.
qrparkApkGuard {
    applicationId.set("ng.gsds.qrpark")
    ownPackage.set("ng/gsds/qrpark/")
    aapt2.set(File(android.sdkDirectory, "build-tools/${android.buildToolsVersion}/" +
        if (System.getProperty("os.name").startsWith("Windows")) "aapt2.exe" else "aapt2").path)
    nexgoEnabled.set(nexgoAar != null)
}
