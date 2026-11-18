package ng.gsds.qrpark.guard

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.TaskAction
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile

/** The result of scanning one APK. */
class GuardReport(
    val vendorBuild: Boolean,
    val ownClasses: Int,
    val libraryClasses: Int,
    val vendorClasses: Int,
    val sdkRefsUsed: List<String>,
    val permissions: List<String>,
    val violations: List<String>,
) {
    val passed get() = violations.isEmpty()

    fun text(apk: File) = buildString {
        appendLine("APK guard: ${apk.name} (${if (vendorBuild) "nexgo build" else "standard build"})")
        appendLine("  our classes scanned:      $ownClasses")
        appendLine("  library classes scanned:  $libraryClasses")
        appendLine("  vendor SDK classes:       $vendorClasses")
        appendLine("  permissions:              ${permissions.joinToString().ifEmpty { "none" }}")
        if (vendorBuild) {
            appendLine("  SDK members our code uses (all on the allow-list):")
            sdkRefsUsed.forEach { appendLine("    $it") }
        }
        if (passed) {
            appendLine(
                "RESULT: PASS - " + if (vendorBuild) {
                    "SDK used only through the printer/scanner allow-list; no card, PIN, EMV, key, system, exec, log or adapter-network reference"
                } else {
                    "no vendor class; no card, PIN, EMV, key, system, exec or log reference"
                },
            )
        } else {
            appendLine("RESULT: FAIL - ${violations.size} violation(s)")
            violations.forEach { appendLine("  $it") }
        }
    }
}

object ApkGuard {

    fun scan(apk: File, ownPackage: String, applicationId: String, permissions: List<String>, vendorBuild: Boolean): GuardReport {
        var own = 0
        var library = 0
        var vendor = 0
        val used = sortedSetOf<String>()
        val violations = mutableListOf<String>()
        var sawPrintManager = false
        ZipFile(apk).use { zip ->
            val dexes = zip.entries().toList().filter { Regex("classes\\d*\\.dex").matches(it.name) }
            if (dexes.isEmpty()) violations += "NO DEX FILES: nothing to scan"
            for (entry in dexes) {
                for (c in DexFile(zip.getInputStream(entry).readBytes()).classes()) {
                    when {
                        c.name.startsWith(ownPackage) -> {
                            own++
                            violations += GuardRules.checkOwn(c).map { it.toString() }
                            c.refs.filter { it.kind != RefKind.STRING && GuardRules.isVendor(it.owner) }
                                .forEach { used += it.owner + if (it.member.isEmpty()) "" else "." + it.member }
                            if (c.refs.any { it.owner == "android/print/PrintManager" }) sawPrintManager = true
                        }
                        GuardRules.isVendor(c.name) -> {
                            vendor++
                            if (!vendorBuild && vendor == 1) violations += "STANDARD APK HOLDS A VENDOR CLASS: ${c.name}"
                        }
                        else -> {
                            library++
                            violations += GuardRules.checkLibrary(c).map { it.toString() }
                        }
                    }
                }
            }
        }
        // The scan must be able to see what it is looking for, or a pass means nothing.
        if (own == 0) violations += "BLIND: none of our classes found under $ownPackage"
        if (!sawPrintManager) violations += "BLIND: the scan did not see our known call to android/print/PrintManager"
        if (vendorBuild && "com/nexgo/oaf/apiv3/APIProxy.getDeviceEngine" !in used) {
            violations += "BLIND: the nexgo build's scan did not see our known call APIProxy.getDeviceEngine"
        }
        violations += GuardRules.permissionViolations(permissions, applicationId)
        return GuardReport(vendorBuild, own, library, vendor, used.toList(), permissions, violations)
    }

    /** The APK's declared permissions, by aapt2. Fails closed if aapt2 cannot run. */
    fun permissions(aapt2: File, apk: File): List<String> {
        if (!aapt2.isFile) throw GradleException("APK guard: aapt2 not found at $aapt2")
        val p = ProcessBuilder(aapt2.path, "dump", "permissions", apk.path).redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        if (!p.waitFor(60, TimeUnit.SECONDS) || p.exitValue() != 0) {
            p.destroyForcibly()
            throw GradleException("APK guard: aapt2 dump permissions failed")
        }
        return Regex("uses-permission(?:-sdk-23)?: name='([^']+)'").findAll(out).map { it.groupValues[1] }.toList()
    }
}

abstract class ApkGuardTask : DefaultTask() {
    @get:InputFile abstract val apk: RegularFileProperty
    @get:Input abstract val aapt2: Property<String>
    @get:Input abstract val ownPackage: Property<String>
    @get:Input abstract val applicationId: Property<String>
    @get:Input abstract val vendorBuild: Property<Boolean>
    @get:OutputFile abstract val report: RegularFileProperty

    @TaskAction
    fun run() {
        val apkFile = apk.get().asFile
        val result = ApkGuard.scan(
            apkFile, ownPackage.get(), applicationId.get(),
            ApkGuard.permissions(File(aapt2.get()), apkFile), vendorBuild.get(),
        )
        val text = result.text(apkFile)
        report.get().asFile.apply { parentFile.mkdirs() }.writeText(text)
        logger.lifecycle(text)
        // The APK stays where AGP wrote it (deleting it breaks incremental
        // packaging); the failed build and debugApk/releaseApk, which wait for
        // this task, keep it from being published.
        if (!result.passed) throw GradleException("APK guard failed; see ${report.get().asFile}")
    }
}

abstract class ApkGuardExtension {
    abstract val applicationId: Property<String>
    abstract val ownPackage: Property<String>
    abstract val aapt2: Property<String>
    abstract val nexgoEnabled: Property<Boolean>
}

/**
 * Registers guard<Flavor><Kind>Apk for every variant that exists, runs it
 * after that variant's assemble, and makes its install task wait for it.
 */
class ApkGuardPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val ext = project.extensions.create("qrparkApkGuard", ApkGuardExtension::class.java)
        ext.nexgoEnabled.convention(false)
        project.afterEvaluate {
            val flavors = listOf("standard") + if (ext.nexgoEnabled.get()) listOf("nexgo") else emptyList()
            for (flavor in flavors) for (kind in listOf("debug", "release")) {
                val variant = flavor.replaceFirstChar { it.uppercase() } + kind.replaceFirstChar { it.uppercase() }
                val guard = project.tasks.register("guard${variant}Apk", ApkGuardTask::class.java) { t ->
                    t.group = "verification"
                    t.description = "Scans the $flavor $kind APK for forbidden APIs, vendor classes and permissions"
                    t.apk.set(project.layout.buildDirectory.file("outputs/apk/$flavor/$kind/app-$flavor-$kind.apk"))
                    t.report.set(project.layout.buildDirectory.file("apk-guard/$flavor-$kind.txt"))
                    t.aapt2.set(ext.aapt2)
                    t.ownPackage.set(ext.ownPackage)
                    t.applicationId.set(ext.applicationId)
                    t.vendorBuild.set(flavor != "standard")
                    t.outputs.upToDateWhen { false }
                    t.dependsOn("assemble$variant")
                }
                project.tasks.named("assemble$variant") { it.finalizedBy(guard) }
                project.tasks.matching { it.name == "install$variant" }.configureEach { it.dependsOn(guard) }
            }
        }
    }
}
