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
 * reads properties and git, and registers three tasks:
 *
 *   checkReleaseConfig  runs before every release build; fails with the full
 *                       list of what is wrong (address, git, signing)
 *   debugApk            assembleDebug, then the APK copied to
 *                       build/apk/qrpark-<version>-debug.apk with a .sha256,
 *                       deleting the previous debug APK and its .sha256 in
 *                       the same step
 *   releaseApk          the same for the signed release (Sprint 4c): it meets
 *                       checkReleaseConfig first, so it cannot be built with
 *                       an http address or without signing
 *   nexgoDebugApk,      MINO-1: the same for the nexgo flavour, named
 *   nexgoReleaseApk     qrpark-<version>-nexgo-<kind>.apk; they exist only when
 *                       the Nexgo SDK is set (nexgo.aar). debugApk and
 *                       releaseApk build the standard flavour, as before.
 *
 * Every APK task waits for the APK guard of its variant (qrpark.apkguard), so
 * no published APK skipped it.
 *
 * Copied from eparking 359c0c1 android/build-logic/.../EparkingReleasePlugin.kt
 * and adapted: names, debugApk and releaseApk in place of vendorApk; MINO-1
 * added the flavours back (standard, nexgo).
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

        registerApkTask(project, ext, "debugApk", "debug", STANDARD)
        registerApkTask(project, ext, "releaseApk", "release", STANDARD)
        for (flavor in VENDOR_FLAVORS) {
            registerApkTask(project, ext, "${flavor}DebugApk", "debug", flavor)
            registerApkTask(project, ext, "${flavor}ReleaseApk", "release", flavor)
        }
    }

    /**
     * [taskName]: assemble<Kind>, then the APK copied to
     * build/apk/qrpark-<version>-<kind>.apk with a .sha256, deleting the
     * previous APK of the same kind and its .sha256 in the same step. The
     * release one runs checkReleaseConfig first (through preReleaseBuild).
     */
    private fun registerApkTask(project: Project, ext: QrparkReleaseExtension, taskName: String, kind: String, flavor: String) {
        project.tasks.register(taskName) { task ->
            task.group = "qrpark"
            task.description = "Builds the $flavor $kind APK, named by version, build number and commit, with a SHA-256 file."
            // Matched lazily: without the Nexgo SDK the nexgo variants do not exist.
            task.dependsOn(project.tasks.matching { it.name == assembleTask(kind, flavor) })
            task.dependsOn(project.tasks.matching { it.name == "guard${variantName(kind, flavor)}Apk" })
            task.doLast {
                if (project.tasks.findByName(assembleTask(kind, flavor)) == null) {
                    throw GradleException("The $flavor build does not exist here: set nexgo.aar in local.properties (android/BUILDING.md).")
                }
                val built = project.layout.buildDirectory.file(builtApkPath(kind, flavor)).get().asFile
                if (!built.isFile) throw GradleException("No $flavor $kind APK at $built")
                val name = apkFileName(ext.versionName, kind, flavor)
                val outDir = project.layout.buildDirectory.dir("apk").get().asFile.apply { mkdirs() }
                for (old in previousApks(outDir.list()?.toList().orEmpty(), kind, keep = name, flavor = flavor)) {
                    File(outDir, old).delete()
                    println("Deleted:    ${File(outDir, old)}")
                }
                val apk = File(outDir, name)
                built.copyTo(apk, overwrite = true)
                File(outDir, "$name.sha256").writeText(sha256Line(apk.readBytes(), name))
                println("${kind.replaceFirstChar { it.uppercase() }} APK: $apk")
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
