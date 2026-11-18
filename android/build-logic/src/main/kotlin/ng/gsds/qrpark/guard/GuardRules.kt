package ng.gsds.qrpark.guard

/**
 * What the app's code may and may not refer to, checked on the built APK
 * (MINO-1, CLAUDE.md "Nexgo devices").
 *
 *  - The Nexgo SDK only through [ALLOWED_VENDOR]: the engine, device info
 *    (presence only), the printer and the camera scanner. Any other vendor
 *    reference fails, whether or not a category below names it.
 *  - FORBIDDEN everywhere in our code, by category: card readers, PIN, EMV,
 *    keys, system control (install, reboot, clock, buttons, settings), process
 *    exec, dynamic code and reflection (so nothing can reach the SDK by name),
 *    and logging (android.util.Log).
 *  - The Nexgo adapter package [ADAPTER_PACKAGE] also may not open a network
 *    connection: the app's own HTTPS client lives elsewhere.
 *  - Library classes (AndroidX, CameraX, zxing, Kotlin) never touch the SDK.
 *  - The standard APK holds no vendor class at all.
 *  - Permissions: exactly the app's own set; no build adds one.
 *
 * Adapted from C:\Dev\qrpark-n86-probe build-logic/.../GuardRules.kt (N86-1):
 * the allow-list narrowed to what the app uses; networking forbidden only in
 * the adapter package (the app talks to its backend); the standard-APK rule
 * and the app's permission set added.
 */
object GuardRules {

    val VENDOR_PREFIXES = listOf("com/nexgo/", "com/xgd/", "com/xinguodu/", "com/srt/", "com/example/libtr34/")

    /** Our Nexgo adapters (src/nexgo). Stricter: no network either. */
    const val ADAPTER_PACKAGE = "ng/gsds/qrpark/nexgo/"

    private const val API = "com/nexgo/oaf/apiv3/"

    /** owner -> members our code may use ("" = the type itself, "*" = any member). */
    val ALLOWED_VENDOR: Map<String, Set<String>> = mapOf(
        "${API}APIProxy" to setOf("getDeviceEngine"),
        "${API}DeviceEngine" to setOf("", "getDeviceInfo", "getPrinter", "getScanner"),
        "${API}DeviceInfo" to setOf(""),
        "${API}device/printer/Printer" to setOf("", "initPrinter", "getStatus", "appendImage", "feedPaper", "startPrint"),
        "${API}device/printer/OnPrintListener" to setOf("", "onPrintResult"),
        "${API}device/printer/AlignEnum" to setOf("*"),
        "${API}device/scanner/Scanner" to setOf("", "initScanner", "startScan", "stopScan"),
        "${API}device/scanner/ScannerCfgEntity" to setOf("", "<init>", "setUsedFrontCcd", "setBulkMode", "setAutoFocus"),
        "${API}device/scanner/OnScannerListener" to setOf("", "onInitResult", "onScannerResult"),
        "${API}SdkResult" to setOf("*"),
    )

    /** Strings our code may hold that name a vendor package: the service presence check. */
    val ALLOWED_VENDOR_STRINGS = setOf("com.xgd.possystemservice")

    data class Forbidden(val category: String, val owner: String, val member: String? = null) {
        fun matches(r: Ref) = r.kind != RefKind.STRING &&
            (if (owner.endsWith("/")) r.owner.startsWith(owner) else r.owner == owner) &&
            (member == null || r.member == member)
    }

    private fun engine(category: String, vararg members: String) =
        members.map { Forbidden(category, "${API}DeviceEngine", it) }

    val FORBIDDEN: List<Forbidden> = buildList {
        add(Forbidden("CARD", "${API}card/"))
        add(Forbidden("CARD", "${API}device/reader/"))
        addAll(engine("CARD",
            "getCardReader", "getCPUCardHandler", "getM1CardHandler", "getMemoryCardHandler",
            "getDesfireHandler", "getUltralightCCardHandler", "getRf15693CardHandler",
            "getUltralightEV1CardHandler", "getUltralightCardHandler", "getNTAGCardHandler",
            "getM1PlusCardHandler", "getCardEmulationHandler", "getMifareSamCardHandler"))
        add(Forbidden("PIN", "${API}device/pinpad/"))
        add(Forbidden("PIN", "${API}device/extpinpad/"))
        add(Forbidden("PIN", "${API}device/numberkeyborad/"))
        addAll(engine("PIN", "getPinPad", "getExtPinPad", "getNumberKeyborad"))
        add(Forbidden("EMV", "${API}emv/"))
        addAll(engine("EMV", "getEmvHandler", "getEmvHandler2"))
        add(Forbidden("KEY", "${API}hsm/"))
        add(Forbidden("KEY", "com/example/libtr34/"))
        add(Forbidden("KEY", "${API}DeviceInfo", "getKsn"))
        addAll(engine("KEY", "getHSMDevice"))
        add(Forbidden("SYSTEM", "${API}platform/"))
        addAll(engine("SYSTEM", "getPlatform", "installApp", "uninstallApp", "setSystemClock"))
        add(Forbidden("SYSTEM", "com/xgd/smartpos/manager/"))
        add(Forbidden("SYSTEM", "android/content/pm/PackageInstaller"))
        add(Forbidden("SYSTEM", "android/app/admin/"))
        add(Forbidden("SYSTEM", "android/os/PowerManager", "reboot"))
        add(Forbidden("SYSTEM", "android/app/AlarmManager", "setTime"))
        add(Forbidden("SYSTEM", "android/app/AlarmManager", "setTimeZone"))
        add(Forbidden("SYSTEM", "android/os/SystemClock", "setCurrentTimeMillis"))
        for (table in listOf("Global", "Secure", "System")) {
            add(Forbidden("SYSTEM", "android/provider/Settings\$$table", "putInt"))
            add(Forbidden("SYSTEM", "android/provider/Settings\$$table", "putString"))
        }
        add(Forbidden("EXEC", "java/lang/Runtime", "exec"))
        add(Forbidden("EXEC", "java/lang/ProcessBuilder"))
        add(Forbidden("EXEC", "dalvik/system/"))
        add(Forbidden("EXEC", "java/lang/Class", "forName"))
        add(Forbidden("EXEC", "java/lang/ClassLoader", "loadClass"))
        add(Forbidden("EXEC", "java/lang/reflect/"))
        add(Forbidden("EXEC", "java/lang/System", "loadLibrary"))
        add(Forbidden("EXEC", "java/lang/System", "load"))
        add(Forbidden("LOG", "android/util/Log"))
    }

    /** Extra, for the adapter package only: it never opens a connection. */
    val FORBIDDEN_IN_ADAPTER: List<Forbidden> = listOf(
        Forbidden("NETWORK", "java/net/"),
        Forbidden("NETWORK", "javax/net/"),
        Forbidden("NETWORK", "android/net/"),
    )

    data class Violation(val inClass: String, val ref: Ref, val why: String) {
        override fun toString() =
            "$why: $inClass -> ${ref.kind} ${if (ref.kind == RefKind.STRING) "(a vendor name)" else ref.owner}" +
                if (ref.member.isEmpty()) "" else "." + ref.member
    }

    fun isVendor(name: String) = VENDOR_PREFIXES.any { name.startsWith(it) }

    private fun allowedVendor(r: Ref): Boolean {
        val members = ALLOWED_VENDOR[r.owner] ?: return false
        return "*" in members || r.member in members ||
            (r.kind == RefKind.TYPE || r.kind == RefKind.SUPER) && "" in members
    }

    private fun vendorString(s: String) = s !in ALLOWED_VENDOR_STRINGS &&
        VENDOR_PREFIXES.any { p -> s.contains(p) || s.contains(p.replace('/', '.')) }

    /** Checks one of OUR classes. */
    fun checkOwn(c: DexClass): List<Violation> = c.refs.mapNotNull { r ->
        val named = FORBIDDEN.firstOrNull { it.matches(r) }
            ?: if (c.name.startsWith(ADAPTER_PACKAGE)) FORBIDDEN_IN_ADAPTER.firstOrNull { it.matches(r) } else null
        when {
            named != null -> Violation(c.name, r, "FORBIDDEN ${named.category}")
            r.kind == RefKind.STRING && vendorString(r.owner) -> Violation(c.name, r, "FORBIDDEN vendor name in a string")
            r.kind != RefKind.STRING && isVendor(r.owner) && !allowedVendor(r) -> Violation(c.name, r, "NOT ON THE SDK ALLOW-LIST")
            else -> null
        }
    }

    /** Checks a library class (neither ours nor the SDK's): no vendor reference at all. */
    fun checkLibrary(c: DexClass): List<Violation> = c.refs.mapNotNull { r ->
        if (r.kind != RefKind.STRING && isVendor(r.owner)) Violation(c.name, r, "LIBRARY TOUCHES THE SDK") else null
    }

    /** The app's permissions, in every build: the network, the camera, AndroidX's own receiver permission. */
    fun permissionViolations(permissions: List<String>, applicationId: String): List<String> {
        val allowed = setOf(
            "android.permission.INTERNET",
            "android.permission.CAMERA",
            "$applicationId.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
        )
        return permissions.filter { it !in allowed }.map { "PERMISSION NOT ALLOWED: $it" }
    }
}
