package ng.gsds.qrpark.release

import org.gradle.api.GradleException
import org.gradle.api.Plugin
import org.gradle.api.Project
import java.io.File

/**
 * Wires the release rules into the app build:
 *
 *   plugins { id("qrpark.release") }
 *   val release = the<QrparkReleaseExtension>().apply { baseVersion = "0.4.0" }
 *
 * Every rule lives in ReleaseRules.kt, where it is tested. This file only
 * reads properties and git, and registers two tasks:
 *
 *   checkReleaseConfig  runs before every release build; fails with the full
 *                       list of what is wrong (address, git, signing)
 *   debugApk            assembleDebug, then the APK copied to
 *                       build/apk/qrpark-<version>-debug.apk with a .sha256,
 *                       deleting the previous debug APK and its .sha256 in
 *                       the same step
 *
 * Copied from eparking 359c0c1 android/build-logic/.../EparkingReleasePlugin.kt
 * and adapted: names, no flavours, and debugApk in place of vendorApk (the
 * signed release task arrives with the release build in Sprint 4c).
 */
class QrparkReleasePlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val ext = project.extensions.create("qrparkRelease", QrparkReleaseExtension::class.java, project)

        val check = project.tasks.register("checkReleaseConfig") { task ->
            task.group = "qrpark"
            task.description = "Refuses a release build without an https address, git history or signing properties."
            task.doLast {
                val problems = listOfNotNull(releaseAddressProblem(ext.apiBaseUrl), gitProblem(ext.commitCount, ext.shallow)) +
                    signingProblems(ext.signingProperties()) { File(it).isFile }
                if (problems.isNotEmpty()) {
                    throw GradleException(
                        "This release build cannot be made:\n" + problems.joinToString("\n") { "  - $it" },
                    )
                }
            }
        }
        // Release tasks only: a debug build never meets this check.
        project.tasks.matching { isReleasePreBuild(it.name) }.configureEach { it.dependsOn(check) }

        project.tasks.register("debugApk") { task ->
            task.group = "qrpark"
            task.description = "Builds the debug APK, named by version, build number and commit, with a SHA-256 file."
            task.dependsOn("assembleDebug")
            task.doLast {
                val built = project.layout.buildDirectory.file("outputs/apk/debug/app-debug.apk").get().asFile
                if (!built.isFile) throw GradleException("No debug APK at $built")
                val name = apkFileName(ext.versionName, "debug")
                val outDir = project.layout.buildDirectory.dir("apk").get().asFile.apply { mkdirs() }
                for (old in previousApks(outDir.list()?.toList().orEmpty(), "debug", keep = name)) {
                    File(outDir, old).delete()
                    println("Deleted:    ${File(outDir, old)}")
                }
                val apk = File(outDir, name)
                built.copyTo(apk, overwrite = true)
                File(outDir, "$name.sha256").writeText(sha256Line(apk.readBytes(), name))
                println("Debug APK:  $apk")
                println("Checksum:   ${apk.path}.sha256")
            }
        }
    }
}

open class QrparkReleaseExtension(private val project: Project) {
    /** The app's own version, before the build and commit are added. */
    var baseVersion: String = "0.0.0"

    /** -Pqrpark.apiBaseUrl=..., or the emulator's address for dev builds. */
    val apiBaseUrl: String
        get() = (project.findProperty("qrpark.apiBaseUrl") as String?)?.trim()?.takeIf { it.isNotEmpty() }
            ?: DEFAULT_API_BASE_URL

    val commitCount: Int? by lazy { git("rev-list", "--count", "HEAD")?.toIntOrNull() }
    val shallow: Boolean by lazy { git("rev-parse", "--is-shallow-repository") == "true" }
    private val shortSha: String by lazy { git("rev-parse", "--short=7", "HEAD") ?: "nogit" }
    private val dirty: Boolean by lazy { !git("status", "--porcelain").isNullOrEmpty() }

    /** A debug build outside git still builds, as 1. A release build is refused by the check. */
    val versionCode: Int
        get() = commitCount?.takeIf { it > 0 }?.let { versionCodeFor(it, dirty) } ?: 1

    val versionName: String
        get() = versionNameFor(baseVersion, commitCount ?: 0, shortSha, dirty)

    /** The four properties as set, by name. Values are only ever handed to AGP. */
    fun signingProperties(): Map<String, String?> =
        SigningKeys.ALL.associateWith { (project.findProperty(it) as String?)?.trim() }

    /** True when all four are set and the keystore exists. */
    fun hasSigning(): Boolean = signingProblems(signingProperties()) { File(it).isFile }.isEmpty()

    private fun git(vararg args: String): String? = try {
        val process = ProcessBuilder(listOf("git") + args)
            .directory(project.rootDir)
            .redirectErrorStream(true)
            .start()
        val out = process.inputStream.bufferedReader().readText().trim()
        if (process.waitFor() == 0) out else null
    } catch (e: Exception) {
        null
    }
}
