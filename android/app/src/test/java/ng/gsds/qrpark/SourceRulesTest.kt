package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Rules checked on the source itself:
 * - nothing is logged (no tokens, bodies or headers can reach a log);
 * - cleartext is allowed only in the debug source set, to the emulator host;
 * - the ticket token is never written to disk or into an Intent;
 * - backups are off;
 * - no device model names in code.
 */
class SourceRulesTest {

    private val logging = Regex(
        """\bLog\s*\.\s*[a-zA-Z]+\s*\(|android\.util\.Log\b|(?<![.\w]|fun )print(ln)?\s*\(|printStackTrace|System\s*\.\s*(out|err)|\bTimber\b|Logger\.getLogger""",
    )

    @Test
    fun `no main source file logs anything`() {
        val offenders = mainSources().flatMap { f ->
            stripComments(f.readText()).lines().mapIndexedNotNull { i, line -> if (logging.containsMatchIn(line)) "${f.name}:${i + 1}" else null }
        }
        assertEquals(emptyList<String>(), offenders)
        assertTrue("the scan found the sources", mainSources().size >= 10)
    }

    @Test
    fun `the logging scan catches the usual calls`() {
        for (line in listOf("print(token)", "Log.d(TAG, token)", "android.util.Log.w(\"x\", e)", "println(body)", "e.printStackTrace()", "System.out.println(x)", "Log . i (t, m)")) {
            assertTrue(line, logging.containsMatchIn(line))
        }
        // A method of our own called print (the printer adapter) is not stdout.
        for (line in listOf("printer.print(paper) { }", "override fun print(paper: TicketPaper)")) {
            assertTrue(line, !logging.containsMatchIn(line))
        }
    }

    // ------------------------------------------------ cleartext

    private val mainManifest = File("src/main/AndroidManifest.xml").readText()
    private val mainConfig = File("src/main/res/xml/network_security_config.xml").readText()
    private val debugConfig = File("src/debug/res/xml/network_security_config.xml").readText()

    @Test
    fun `the main (release) manifest and network config allow no cleartext`() {
        assertFalse(mainManifest.contains("usesCleartextTraffic"))
        assertTrue(mainManifest.contains("android:networkSecurityConfig=\"@xml/network_security_config\""))
        val config = stripXmlComments(mainConfig)
        assertTrue(config.contains("<base-config cleartextTrafficPermitted=\"false\""))
        assertFalse(config.contains("cleartextTrafficPermitted=\"true\""))
        assertFalse(config.contains("domain-config"))
        assertFalse("no release override with cleartext", File("src/release").exists() && File("src/release").walkTopDown().any { it.isFile && it.readText().contains("cleartextTrafficPermitted=\"true\"") })
    }

    @Test
    fun `cleartext in debug is the emulator host only`() {
        val config = stripXmlComments(debugConfig)
        assertTrue(config.contains("<base-config cleartextTrafficPermitted=\"false\""))
        val domains = Regex("""<domain[^>]*>([^<]*)</domain>""").findAll(config).map { it.groupValues[1].trim() }.toList()
        assertEquals(listOf("10.0.2.2"), domains)
        assertEquals(1, Regex("""cleartextTrafficPermitted="true"""").findAll(config).count())
    }

    @Test
    fun `backups are off`() {
        assertTrue(mainManifest.contains("android:allowBackup=\"false\""))
    }

    // ------------------------------------------------ the token stays in memory

    @Test
    fun `the ticket token is never put in an Intent, saved state or storage`() {
        val code = mainSources().associate { it.name to stripComments(it.readText()) }
        val intentToken = Regex("""(putExtra|putString|bundleOf|putSerializable|putParcelable)\s*\([^)]*(?i:token|ticket\b|IssuedTicket)""")
        val bad = code.filter { (_, src) -> intentToken.containsMatchIn(src) && !src.contains("class SecureStore") }.keys
        assertEquals(emptySet<String>(), bad)
        // Only the encrypted store touches disk, and it has no slot for a ticket.
        val disk = Regex("""getSharedPreferences|openFileOutput|FileOutputStream|\.writeText\(|\.writeBytes\(""")
        val touching = code.filter { (_, src) -> disk.containsMatchIn(src) }.keys
        assertEquals(setOf("SecureStore.kt", "TicketPrint.kt"), touching)
        // TicketPrint writes the PDF to the print system's descriptor, not a file of ours.
        assertTrue(code.getValue("TicketPrint.kt").contains("FileOutputStream(destination.fileDescriptor)"))
        assertEquals(
            listOf("ACCESS", "ATTEMPT", "DEVICE_ID", "GATE_CODE", "GATE_KIND", "GATE_NAME", "NAME", "PAY_ATTEMPT", "REFRESH", "ROLE", "SITE_NAME", "USERNAME"),
            SecureStore.Slot.values().map { it.name }.sorted(),
        )
    }

    @Test
    fun `the camera hands its scan over in memory, never in an Intent or a result`() {
        val scan = stripComments(java.io.File("src/main/java/ng/gsds/qrpark/ScanActivity.kt").readText())
        assertFalse("ScanActivity puts nothing in an Intent", Regex("""putExtra|putExtras|setData|Bundle\(""").containsMatchIn(scan))
        assertFalse("ScanActivity returns no data", Regex("""setResult\s*\([^)]*,""").containsMatchIn(scan))
        assertTrue("it hands over through ScanHand", scan.contains("ScanHand.put("))
        val booth = stripComments(java.io.File("src/main/java/ng/gsds/qrpark/BoothActivity.kt").readText())
        assertFalse("the booth reads no scan from an Intent", Regex("""getStringExtra|getExtras|\.data\b|getParcelable""").containsMatchIn(booth))
        assertFalse("the booth puts nothing scanned in an Intent", Regex("""putExtra\s*\([^)]*(?i:scan|token|code|checkout|url)""").containsMatchIn(booth))
    }

    @Test
    fun `the booth's scan field never shows what was scanned (a token)`() {
        val layout = java.io.File("src/main/res/layout/activity_booth.xml").readText()
        val field = Regex("""<ng\.gsds\.qrpark\.ScanTextField[\s\S]*?/>""").find(layout)?.value.orEmpty()
        assertTrue(field, field.contains("android:id=\"@+id/scanField\""))
        assertTrue(field, field.contains("textPassword"))
        assertTrue(field, field.contains("android:importantForAutofill=\"no\""))
    }

    @Test
    fun `the checkout address is opened only through the Paystack check, and never stored`() {
        val booth = stripComments(java.io.File("src/main/java/ng/gsds/qrpark/BoothActivity.kt").readText())
        assertTrue(booth.contains("checkoutToOpen("))
        // Sprint 4b fix: inside the app, in CheckoutSheet; no browser hand-off.
        assertTrue(booth.contains("CheckoutSheet.open("))
        assertFalse(Regex("""Uri\.parse\(|ACTION_VIEW""").containsMatchIn(booth))
        assertFalse(SecureStore.Slot.values().any { it.name.contains("URL") || it.name.contains("CHECKOUT") || it.name.contains("TOKEN") })
    }

    @Test
    fun `no device model names or serial numbers in code`() {
        val models = Regex("""(?i)\b(M960|MF960|morefun|nexgo|AF910|P1000|sunmi|pax\b|ingenico|verifone|Build\.(MODEL|SERIAL|getSerial))""")
        val bad = mainSources().filter { models.containsMatchIn(it.readText()) }.map { it.name }
        assertEquals(emptyList<String>(), bad)
    }

    private fun stripXmlComments(xml: String) = xml.replace(Regex("""<!--[\s\S]*?-->"""), "")
}
