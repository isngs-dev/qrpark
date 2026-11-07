// The release BUILD rules (release address guard, signing check, version
// numbering, APK naming), included by android/settings.gradle.kts. Build logic
// only: the app itself is the one module, :app.
// Copied from eparking 359c0c1 android/build-logic/settings.gradle.kts.
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
}
rootProject.name = "build-logic"
