package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * MINO-1, the print gate, checked on the source of every build (main,
 * standard and nexgo):
 *  - printing is reachable only from the entry ticket screen (TicketActivity),
 *    which only the Entry screen (a new ticket) and the Tickets list (a
 *    reprint of the same ticket) open, and only an entry operator reaches;
 *  - never from the payment booth, the exit or Check;
 *  - the print path never calls the backend, so it creates no ticket and no
 *    payment.
 * The exit rule (PAID only) is the backend's and is not touched here.
 */
class PrintReachTest {

    private val sources: Map<String, String> = appSources().associate { it.path.replace('\\', '/') to stripComments(it.readText()) }
    private fun named(name: String) = sources.filterKeys { it.endsWith("/$name") }

    /** Anything that prints, or makes a printer. */
    private val printing = Regex(
        """\bchoosePrinter\s*\(|PrinterChosenAtPrint\s*\(|TicketPrintAction\s*\(|AndroidTicketPrinter\s*\(|NexgoTicketPrinter\s*\(|\.print\s*\(\s*paper|PrintManager|PaperArt\.render\s*\(|FlavourDevices\.printer\s*\(""",
    )

    /** Where printing may appear: the ticket screen, and the printer seam's own files. */
    private val printFiles = setOf(
        "TicketActivity.kt", // the Print button
        "TicketPrint.kt", // the seam: choosePrinter, Android printing, PaperArt
        "DeviceRules.kt", // TicketPrintAction
        "FlavourDevices.kt", // standard: none; nexgo: the Nexgo printer
        "NexgoTicketPrinter.kt", // the Nexgo printer itself
    )

    @Test fun `printing appears only in the ticket screen and the printer seam`() {
        val offenders = sources.filter { (path, src) -> printing.containsMatchIn(src) && path.substringAfterLast('/') !in printFiles }.keys
        assertEquals(emptySet<String>(), offenders)
        assertTrue("the scan sees the Print button", printing.containsMatchIn(named("TicketActivity.kt").values.single()))
        assertTrue("the scan found every build's sources", sources.keys.any { "src/standard/" in it } && sources.keys.any { "src/main/" in it })
    }

    @Test fun `the ticket screen is opened only by Entry (a new ticket) and the Tickets list (a reprint)`() {
        val opens = Regex("""TicketActivity::class""")
        val openers = sources.filter { (_, src) -> opens.containsMatchIn(src) }.keys.map { it.substringAfterLast('/') }.toSet()
        assertEquals(setOf("EntryActivity.kt", "TicketsActivity.kt"), openers)
        // Both show only a ticket the backend returned: POST /tickets, or POST /tickets/reprint (the same QR).
        val assign = Regex("""TicketHolder\.current\s*=\s*([A-Za-z_][A-Za-z0-9_.]*)""")
        val holders = sources.filter { (_, src) -> assign.findAll(src).any { it.groupValues[1] != "null" } }.keys
            .map { it.substringAfterLast('/') }.toSet()
        assertEquals(setOf("EntryActivity.kt", "TicketsActivity.kt"), holders)
        assertTrue(named("TicketsActivity.kt").values.single().contains("BackendClient.reprint("))
    }

    @Test fun `only an entry operator reaches the Entry screen and the Tickets list`() {
        val entryOpeners = sources.filter { (_, src) -> src.contains("EntryActivity::class") }.keys.map { it.substringAfterLast('/') }.toSet()
        assertEquals(setOf("UiBits.kt"), entryOpeners)
        assertTrue(named("UiBits.kt").values.single().contains("session.mode.opensEntry -> EntryActivity::class.java"))
        assertEquals(listOf(Mode.ENTRY), Mode.values().filter { it.opensEntry })
        val listOpeners = sources.filter { (_, src) -> Regex("""TicketsActivity\.(today|lookup)\(""").containsMatchIn(src) }.keys
            .map { it.substringAfterLast('/') }.toSet()
        assertEquals(setOf("EntryActivity.kt"), listOpeners)
    }

    @Test fun `the booth, exit and Check never print`() {
        for (name in listOf("BoothActivity.kt", "BoothRules.kt", "PaymentAttempts.kt", "CheckoutSheet.kt", "CheckoutPage.kt",
            "CheckoutNavigation.kt", "ExitActivity.kt", "ExitRules.kt", "CheckActivity.kt", "CheckView.kt")) {
            val src = named(name).values.single()
            assertFalse(name, printing.containsMatchIn(src))
            assertFalse(name, src.contains("TicketActivity"))
        }
    }

    @Test fun `the print path never calls the backend, so it creates no ticket and no payment`() {
        val backend = Regex("""BackendClient|/tickets|/payments|HttpURLConnection|openConnection""")
        val path = sources.filterKeys { it.substringAfterLast('/') in printFiles + setOf("DeviceExtras.kt", "NexgoDevice.kt") }
        assertTrue(path.size >= 5)
        assertEquals(emptySet<String>(), path.filter { (_, src) -> backend.containsMatchIn(src) }.keys)
    }

    @Test fun `the QR on every printed ticket is the paper's token, drawn by us`() {
        val tp = named("TicketPrint.kt").values.single()
        assertTrue(tp.contains("QrCodec.render(paper.qrToken"))
        assertEquals("one QR, from the paper", 1, Regex("""QrCodec\.render\(""").findAll(tp).count())
        val nexgo = sources.filter { (path, _) -> path.endsWith("/NexgoTicketPrinter.kt") }.values
        nexgo.forEach { src ->
            assertTrue(src.contains("PaperArt.render(activity, paper,"))
            assertFalse("the SDK never gets the token as text", Regex("""appendQRcode|appendPrnStr|appendBarcode""").containsMatchIn(src))
        }
    }
}

/** Every app source of every build flavour: src/main, src/standard and src/nexgo. */
fun appSources(): List<File> = listOf("src/main/java", "src/standard/java", "src/nexgo/java")
    .map(::File).filter { it.isDirectory }
    .flatMap { dir -> dir.walkTopDown().filter { it.isFile && it.extension in setOf("kt", "java") }.toList() }
