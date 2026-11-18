package ng.gsds.qrpark.guard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** GuardRules.kt: what the app's code may reference in the built APK (MINO-1). */
class GuardRulesTest {

    private val api = "com/nexgo/oaf/apiv3/"
    private fun inClass(name: String, vararg refs: Ref) = GuardRules.checkOwn(DexClass(name, refs.toSet()))
    private fun own(vararg refs: Ref) = inClass("ng/gsds/qrpark/TicketActivity", *refs)
    private fun adapter(vararg refs: Ref) = inClass("ng/gsds/qrpark/nexgo/NexgoTicketPrinter", *refs)
    private fun m(owner: String, member: String) = Ref(RefKind.METHOD, owner, member)

    @Test fun `the printer and scanner calls on the allow-list pass`() {
        val v = adapter(
            m("${api}APIProxy", "getDeviceEngine"),
            m("${api}DeviceEngine", "getPrinter"),
            m("${api}DeviceEngine", "getScanner"),
            m("${api}DeviceEngine", "getDeviceInfo"),
            Ref(RefKind.TYPE, "${api}DeviceInfo", ""),
            m("${api}device/printer/Printer", "initPrinter"),
            m("${api}device/printer/Printer", "appendImage"),
            m("${api}device/printer/Printer", "startPrint"),
            m("${api}device/scanner/Scanner", "initScanner"),
            m("${api}device/scanner/Scanner", "startScan"),
            Ref(RefKind.SUPER, "${api}device/printer/OnPrintListener", ""),
            Ref(RefKind.SUPER, "${api}device/scanner/OnScannerListener", ""),
            Ref(RefKind.FIELD, "${api}device/printer/AlignEnum", "CENTER"),
            Ref(RefKind.STRING, "com.xgd.possystemservice", ""),
        )
        assertEquals(emptyList<GuardRules.Violation>(), v)
    }

    @Test fun `card, PIN, EMV, key, system, exec and log references are named and refused, in any of our classes`() {
        val cases = mapOf(
            m("${api}DeviceEngine", "getCardReader") to "CARD",
            m("${api}device/reader/CardReader", "searchCard") to "CARD",
            m("${api}DeviceEngine", "getPinPad") to "PIN",
            m("${api}DeviceEngine", "getEmvHandler2") to "EMV",
            m("${api}emv/EmvHandler2", "emvProcess") to "EMV",
            m("${api}DeviceEngine", "getHSMDevice") to "KEY",
            m("${api}DeviceInfo", "getKsn") to "KEY",
            m("${api}DeviceEngine", "getPlatform") to "SYSTEM",
            m("${api}platform/Platform", "rebootDevice") to "SYSTEM",
            m("${api}DeviceEngine", "installApp") to "SYSTEM",
            m("${api}DeviceEngine", "setSystemClock") to "SYSTEM",
            m("${api}platform/Platform", "disableHomeButton") to "SYSTEM",
            m("android/os/PowerManager", "reboot") to "SYSTEM",
            m("android/provider/Settings\$Global", "putInt") to "SYSTEM",
            m("java/lang/Runtime", "exec") to "EXEC",
            m("java/lang/Class", "forName") to "EXEC",
            m("android/util/Log", "d") to "LOG",
        )
        for (where in listOf(::own, ::adapter)) {
            cases.forEach { (ref, category) ->
                val v = where(arrayOf(ref))
                assertEquals("$ref", 1, v.size)
                assertEquals("$ref", "FORBIDDEN $category", v.single().why)
            }
        }
    }

    @Test fun `the adapter package may not open a connection, the app's own client may`() {
        assertEquals("FORBIDDEN NETWORK", adapter(m("java/net/URL", "openConnection")).single().why)
        assertEquals(emptyList<GuardRules.Violation>(), inClass("ng/gsds/qrpark/BackendClient", m("java/net/URL", "openConnection")))
    }

    @Test fun `any other SDK member is refused even if no category names it`() {
        val v = adapter(m("${api}DeviceEngine", "getBeeper"), m("${api}device/printer/Printer", "cutPaper"), m("${api}DeviceInfo", "getSn"))
        assertEquals(3, v.size)
        assertTrue(v.all { it.why == "NOT ON THE SDK ALLOW-LIST" })
    }

    @Test fun `a vendor class name in a string is refused (reflection by name)`() {
        val v = own(Ref(RefKind.STRING, "com.nexgo.oaf.apiv3.platform.PlatformImpl", ""))
        assertEquals("FORBIDDEN vendor name in a string", v.single().why)
    }

    @Test fun `a library class may not touch the SDK`() {
        val v = GuardRules.checkLibrary(DexClass("androidx/x/Y", setOf(m("${api}APIProxy", "getDeviceEngine"))))
        assertEquals("LIBRARY TOUCHES THE SDK", v.single().why)
    }

    @Test fun `only the app's own permissions are allowed, in every build`() {
        val id = "ng.gsds.qrpark"
        assertEquals(emptyList<String>(), GuardRules.permissionViolations(
            listOf("android.permission.INTERNET", "android.permission.CAMERA", "$id.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"), id))
        assertEquals(
            listOf("PERMISSION NOT ALLOWED: android.permission.READ_LOGS"),
            GuardRules.permissionViolations(listOf("android.permission.INTERNET", "android.permission.READ_LOGS"), id),
        )
    }
}
