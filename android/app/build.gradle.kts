plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("qrpark.release")
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

    buildTypes {
        release {
            // Release signing arrives in Sprint 4c. Until then no release
            // signing config exists, so nothing falls back to the debug key.
            isMinifyEnabled = false
        }
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

    // JVM unit tests for the pure rule files (no Android imports), so they
    // run in seconds with no emulator and no backend.
    testImplementation("junit:junit:4.13.2")
}

// Some tests read source files (the logging scan, the network config and the
// money rule), so editing them reruns the tests instead of reusing a pass.
tasks.withType<Test>().configureEach {
    inputs.dir("src/main")
    inputs.dir("src/debug")
}
