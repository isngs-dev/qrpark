plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
        // Real version numbering and release signing arrive in Sprint 4.
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
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
    implementation("com.google.android.material:material:1.12.0")
}
