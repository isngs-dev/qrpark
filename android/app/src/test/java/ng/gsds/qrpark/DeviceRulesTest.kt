package ng.gsds.qrpark

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MINO-1, DeviceRules.kt: the device's own printer and scanner (the Nexgo
 * adapters translate into these), driven here by a FAKE printer and a FAKE
 * scanner - no device, no vendor code.
 */
class DeviceRulesTest {

    /** Records every paper it is given; answers with [answer], or holds the callback when [hold]. */
    private class FakePrinter(var answer: TicketPrinter.Outcome = TicketPrinter.Outcome.SENT, val hold: Boolean = false) : TicketPrinter {
        val printed = mutableListOf<TicketPaper>()
        var pending: ((TicketPrinter.Outcome) -> Unit)? = null
        override fun print(paper: TicketPaper, onOutcome: (TicketPrinter.Outcome) -> Unit) {
            printed += paper
            if (hold) pending = onOutcome else onOutcome(answer)
        }
    }

    /** Reports whatever the test says, as often as the test says (a real scanner reports once). */
    private class FakeScanner : VendorScanner {
        var report: ((VendorScanEnd, String?) -> Unit)? = null
        var stopped = false
        override fun scan(onEnd: (VendorScanEnd, String?) -> Unit) { report = onEnd }
        override fun stop() { stopped = true }
    }

    /** A screen's field, as Booth, Check and Exit hold it. */
    private class FakeField : ScanTarget {
        override var text = ""
        var submitted = 0
        override fun submit() { submitted++ }
    }

    @After fun clearHand() = ScanHand.clear()

    // ------------------------------------------------ choosing, by capability

    @Test fun `the device's own printer is used only when it answered, else Android printing as on every phone`() {
        assertEquals(PrinterChoice.VENDOR, printerChoice(vendorReady = true, androidPrinting = true))
        assertEquals(PrinterChoice.ANDROID, printerChoice(vendorReady = false, androidPrinting = true))
        assertEquals(PrinterChoice.NONE, printerChoice(vendorReady = false, androidPrinting = false))
        assertEquals(ScanChoice.VENDOR, scanChoice(vendorReady = true))
        assertEquals(ScanChoice.CAMERA, scanChoice(vendorReady = false))
    }

    // ------------------------------------------------ printing (fake printer)

    @Test fun `Print prints exactly the ticket's paper - its token as the QR - and one print at a time`() {
        val printer = FakePrinter(hold = true)
        val paper = ticketPaper(sampleTicket(token = "A".repeat(43)))
        val action = TicketPrintAction(printer, paper)
        val outcomes = mutableListOf<TicketPrinter.Outcome>()
        assertTrue(action.press { outcomes += it })
        assertFalse("a second tap while printing does nothing", action.press { outcomes += it })
        assertEquals(1, printer.printed.size)
        assertEquals("A".repeat(43), printer.printed.single().qrToken)
        printer.pending!!(TicketPrinter.Outcome.SENT)
        assertEquals(listOf(TicketPrinter.Outcome.SENT), outcomes)
        assertTrue("after the outcome, Print works again", action.press { outcomes += it })
        assertEquals(2, printer.printed.size)
    }

    @Test fun `a reprint prints the same QR as the first print`() {
        // POST /tickets and POST /tickets/reprint return the same ticket (the
        // backend's reprint test); the app turns both into the same paper.
        val issued = sampleTicket(token = "Q".repeat(43))
        val reprinted = issued.copy()
        val printer = FakePrinter()
        TicketPrintAction(printer, ticketPaper(issued)).press {}
        TicketPrintAction(printer, ticketPaper(reprinted)).press {}
        assertEquals(2, printer.printed.size)
        assertEquals(printer.printed[0].qrToken, printer.printed[1].qrToken)
        assertEquals(issued.token, printer.printed[1].qrToken)
        assertEquals(printer.printed[0], printer.printed[1])
        // And a different ticket is a different QR: the check above can fail.
        assertFalse(ticketPaper(sampleTicket(token = "R".repeat(43))).qrToken == printer.printed[0].qrToken)
    }

    @Test fun `a vendor print is SENT only when every call was accepted and the printer's callback confirmed it`() {
        assertEquals(TicketPrinter.Outcome.SENT, vendorPrintOutcome(accepted = true, confirmed = true))
        assertEquals(TicketPrinter.Outcome.FAILED, vendorPrintOutcome(accepted = true, confirmed = false))
        assertEquals("no callback is never success", TicketPrinter.Outcome.FAILED, vendorPrintOutcome(accepted = true, confirmed = null))
        assertEquals(TicketPrinter.Outcome.FAILED, vendorPrintOutcome(accepted = false, confirmed = true))
        assertEquals(TicketPrinter.Outcome.FAILED, vendorPrintOutcome(accepted = false, confirmed = null))
    }

    @Test fun `the ticket is drawn at the printer's own width, else at 384 dots (58 mm)`() {
        assertEquals(384, FALLBACK_PAPER_DOTS)
        assertEquals(384, ticketWidthDots(null))
        assertEquals(576, ticketWidthDots(576))
        assertEquals(384, ticketWidthDots(384))
        assertEquals("nonsense is ignored", 384, ticketWidthDots(0))
        assertEquals(384, ticketWidthDots(-1))
        assertEquals(384, ticketWidthDots(100_000))
    }

    // ------------------------------------------------ scanning (fake scanner)

    @Test fun `a vendor read reaches the screen exactly as a camera read does, and never acts by itself`() {
        // The camera path: ScanActivity puts the read into ScanHand; the screen
        // takes it in onResume and delivers it.
        val viaCamera = FakeField()
        ScanHand.put("TOKEN-123")
        ScanHand.take()?.let { deliverScan(viaCamera, it) }

        // The vendor path: the scan flow puts it into the same ScanHand.
        val scanner = FakeScanner()
        var camera = 0
        var done = 0
        VendorScanFlow(scanner, hand = { ScanHand.put(it) }, camera = { camera++ }, done = { done++ }).start()
        scanner.report!!(VendorScanEnd.READ, "TOKEN-123")
        val viaVendor = FakeField()
        ScanHand.take()?.let { deliverScan(viaVendor, it) }

        assertEquals(viaCamera.text, viaVendor.text)
        assertEquals("TOKEN-123", viaVendor.text)
        assertEquals("a scan never submits", 0, viaVendor.submitted + viaCamera.submitted)
        assertEquals(0, camera)
        assertEquals(1, done)
        assertNull("taken once", ScanHand.take())
    }

    @Test fun `when the vendor scanner fails the camera opens, and when the operator closes it nothing changes`() {
        fun run(end: VendorScanEnd, text: String?): Triple<String?, Int, Int> {
            ScanHand.clear()
            val scanner = FakeScanner()
            var camera = 0
            var done = 0
            VendorScanFlow(scanner, hand = { ScanHand.put(it) }, camera = { camera++ }, done = { done++ }).start()
            scanner.report!!(end, text)
            return Triple(ScanHand.take(), camera, done)
        }
        assertEquals(Triple(null, 1, 1), run(VendorScanEnd.FAILED, null))
        assertEquals("an empty read is a failure, not a delivery", Triple(null, 1, 1), run(VendorScanEnd.READ, "  "))
        assertEquals(Triple(null, 1, 1), run(VendorScanEnd.READ, null))
        assertEquals(Triple(null, 0, 1), run(VendorScanEnd.USER_CLOSED, null))
        assertEquals(Triple(null, 0, 1), run(VendorScanEnd.TIMED_OUT, null))
    }

    @Test fun `only the first report of a scan counts`() {
        val scanner = FakeScanner()
        val handed = mutableListOf<String>()
        var done = 0
        VendorScanFlow(scanner, hand = { handed += it }, camera = {}, done = { done++ }).start()
        scanner.report!!(VendorScanEnd.READ, "FIRST")
        scanner.report!!(VendorScanEnd.READ, "SECOND")
        scanner.report!!(VendorScanEnd.FAILED, null)
        assertEquals(listOf("FIRST"), handed)
        assertEquals(1, done)
    }

    @Test fun `what follows a scan never shows the read text`() {
        val next = afterVendorScan(VendorScanEnd.READ, "SECRET-TOKEN")
        assertTrue(next is ScanNext.Deliver)
        assertFalse(next.toString().contains("SECRET"))
    }
}
