package ng.gsds.qrpark.release

/**
 * The release rules, as pure functions so they are tested without running an
 * Android build. The plugin only wires them in.
 *
 * Copied from eparking 359c0c1 android/build-logic/.../ReleaseRules.kt and
 * adapted: package and property names (qrpark.*), one app with no flavours,
 * the APK name, and a debug APK task (Sprint 4a: debug builds only).
 */

/** The emulator's view of the host machine. Dev builds keep it as the default. */
const val DEFAULT_API_BASE_URL = "http://10.0.2.2:3000"

/** Why this address may not go into a release build, or null if it may. */
fun releaseAddressProblem(url: String): String? {
    val required = "A release build needs an https:// server address"
    val host = url.removePrefix("https://")
    return when {
        // Case-sensitive on purpose: the scheme is written exactly as the
        // network security config and the Android URL stack expect.
        !url.startsWith("https://") -> "$required, but got \"$url\". Pass -Pqrpark.apiBaseUrl=https://..."
        host.isEmpty() || url.any { it.isWhitespace() } -> "$required with a host and no spaces, but got \"$url\"."
        else -> null
    }
}

/**
 * versionCode from the number of commits on HEAD.
 *
 * A build with uncommitted changes is the NEXT commit in progress, so it is
 * numbered as that commit (count + 1): higher than every build made before
 * it, so it installs over any of them. The commit that follows numbers the
 * same and installs over it too (Android accepts an equal versionCode).
 */
fun versionCodeFor(commitCount: Int, dirty: Boolean = false): Int {
    require(commitCount > 0) { "commit count must be positive, was $commitCount" }
    return if (dirty) commitCount + 1 else commitCount
}

/** e.g. 0.4.0-b437-1e1b858; a dirty build of that commit is 0.4.0-b438-1e1b858-dirty. */
fun versionNameFor(base: String, commitCount: Int, shortSha: String, dirty: Boolean): String =
    "$base-b${if (commitCount > 0) versionCodeFor(commitCount, dirty) else commitCount}-$shortSha" +
        if (dirty) "-dirty" else ""

/** Why the git state cannot number a release build, or null. */
fun gitProblem(commitCount: Int?, shallow: Boolean): String? = when {
    commitCount == null || commitCount < 1 ->
        "A release build is numbered from git history, and none was found. Build from a git checkout."
    // A shallow clone counts only the commits it fetched, so versionCode would
    // go BACKWARDS and a device would refuse the update.
    shallow -> "This is a shallow clone, so the commit count ($commitCount) is not the real one. Run: git fetch --unshallow"
    else -> null
}

/** The four signing properties, read from the user's own gradle.properties. */
object SigningKeys {
    const val STORE_FILE = "qrpark.signing.storeFile"
    const val STORE_PASSWORD = "qrpark.signing.storePassword"
    const val KEY_ALIAS = "qrpark.signing.keyAlias"
    const val KEY_PASSWORD = "qrpark.signing.keyPassword"
    val ALL = listOf(STORE_FILE, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD)
}

/** Everything wrong with the signing setup, by property name - never by value. */
fun signingProblems(props: Map<String, String?>, fileExists: (String) -> Boolean): List<String> {
    val problems = mutableListOf<String>()
    for (key in SigningKeys.ALL) {
        if (props[key].isNullOrBlank()) {
            problems += "$key is not set. Add it to your own ~/.gradle/gradle.properties (never to the repo)."
        }
    }
    // The path is not a secret; the passwords are, and are never printed.
    val store = props[SigningKeys.STORE_FILE]
    if (!store.isNullOrBlank() && !fileExists(store)) {
        problems += "${SigningKeys.STORE_FILE} points at \"$store\", which does not exist."
    }
    return problems
}

/** e.g. qrpark-0.4.0-b6-bfb3724-debug.apk. [kind] is "debug" or "release". */
fun apkFileName(versionName: String, kind: String): String = "qrpark-$versionName-$kind.apk"

/**
 * The earlier APKs of the same kind (and their .sha256 files) in the output
 * folder: deleted in the same step that writes a new one. Never another
 * kind's, never a file that is not ours.
 */
fun previousApks(fileNames: List<String>, kind: String, keep: String): List<String> =
    fileNames.filter { name ->
        val apk = name.removeSuffix(".sha256")
        apk.startsWith("qrpark-") && apk.endsWith("-$kind.apk") && apk != keep
    }

/** The task that builds an APK of [kind] ("debug" or "release"). */
fun assembleTask(kind: String): String = "assemble" + kind.replaceFirstChar { it.uppercase() }

/** Where AGP writes that APK, under the build directory. */
fun builtApkPath(kind: String): String = "outputs/apk/$kind/app-$kind.apk"

/** preReleaseBuild: meets checkReleaseConfig. No debug task does. */
fun isReleasePreBuild(taskName: String): Boolean =
    taskName.startsWith("pre") && taskName.endsWith("ReleaseBuild")

/** The line `sha256sum -c` reads: "<hex>  <file name>". */
fun sha256Line(bytes: ByteArray, fileName: String): String {
    val digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { "%02x".format(it) } + "  " + fileName + "\n"
}
