plugins {
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    `java-gradle-plugin`
}

// The running JDK compiles it; bytecode targets 17, like the app.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

gradlePlugin {
    plugins {
        create("qrparkRelease") {
            id = "qrpark.release"
            implementationClass = "ng.gsds.qrpark.release.QrparkReleasePlugin"
        }
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
