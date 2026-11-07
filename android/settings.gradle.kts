pluginManagement {
    // The release rules (HTTPS guard, signing check, version numbering, APK
    // naming). Build logic only; the app is the one module, :app.
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "QR Parking"
include(":app")
