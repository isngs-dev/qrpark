package ng.gsds.qrpark

/**
 * MINO-1: the rules for a vendor device's own printer and scanner, free of
 * Android and of any vendor code, so they run on the JVM with fakes. The
 * vendor adapters (in their flavour's source set) only translate the vendor's calls into these.
 *
 * Chosen at run time by what the device can do - its own printer or scanner
 * answered - never by its model (CLAUDE.md, Devices).
 */

enum class PrinterChoice { VENDOR, ANDROID, NONE }

/** The device's own printer when it answered; else Android printing; else none. */
fun printerChoice(vendorReady: Boolean, androidPrinting: Boolean): PrinterChoice = when {
    vendorReady -> PrinterChoice.VENDOR
    androidPrinting -> PrinterChoice.ANDROID
    else -> PrinterChoice.NONE
}

enum class ScanChoice { VENDOR, CAMERA }

/** The device's own scanner when it answered; else the camera (CameraX), as on every phone. */
fun scanChoice(vendorReady: Boolean): ScanChoice = if (vendorReady) ScanChoice.VENDOR else ScanChoice.CAMERA

/** How a vendor scanner's attempt ended. */
enum class VendorScanEnd { READ, USER_CLOSED, TIMED_OUT, FAILED }

/** What follows a vendor scan. */
sealed interface ScanNext {
    /** Hand the text over exactly as the camera does (ScanHand), and nothing else. */
    class Deliver(val text: String) : ScanNext {
        /** Never shows the text: it is a ticket token. */
        override fun toString() = "Deliver(${text.length} characters)"
    }

    /** The scanner did not work: fall back to the camera scan. */
    data object Camera : ScanNext

    /** The operator closed it, or nothing was read in time: back to the screen, unchanged. */
    data object Nothing : ScanNext
}

fun afterVendorScan(end: VendorScanEnd, text: String?): ScanNext = when (end) {
    VendorScanEnd.READ -> text?.trim()?.takeIf { it.isNotEmpty() }?.let { ScanNext.Deliver(it) } ?: ScanNext.Camera
    VendorScanEnd.FAILED -> ScanNext.Camera
    VendorScanEnd.USER_CLOSED, VendorScanEnd.TIMED_OUT -> ScanNext.Nothing
}

/** A vendor scanner, as the flow below drives it. [scan] reports once, on the main thread. */
interface VendorScanner {
    fun scan(onEnd: (VendorScanEnd, String?) -> Unit)

    fun stop()
}

/**
 * One vendor scan: a read goes to [hand] - the same in-memory hand-over the
 * camera uses, so Booth, Check and Exit fill their field exactly as after a
 * camera scan, and never act by themselves - a failure opens the [camera]
 * instead, and [done] closes the scan screen. Only the first report counts.
 */
class VendorScanFlow(
    private val scanner: VendorScanner,
    private val hand: (String) -> Unit,
    private val camera: () -> Unit,
    private val done: () -> Unit,
) {
    private var ended = false

    fun start() = scanner.scan { end, text ->
        if (ended) return@scan
        ended = true
        when (val next = afterVendorScan(end, text)) {
            is ScanNext.Deliver -> hand(next.text)
            ScanNext.Camera -> camera()
            ScanNext.Nothing -> Unit
        }
        done()
    }
}

/**
 * A vendor print's outcome. SENT only when every call was accepted AND the
 * printer's own callback confirmed it; no callback ([confirmed] null) is a
 * failure, never a success.
 */
fun vendorPrintOutcome(accepted: Boolean, confirmed: Boolean?): TicketPrinter.Outcome =
    if (accepted && confirmed == true) TicketPrinter.Outcome.SENT else TicketPrinter.Outcome.FAILED

/** The paper width when the printer does not report one: 384 dots, a 58 mm roll at 203 dpi. */
const val FALLBACK_PAPER_DOTS = 384

/** The width to draw the ticket at: the printer's own figure when it gives a sane one, else [FALLBACK_PAPER_DOTS]. */
fun ticketWidthDots(reported: Int?): Int = reported?.takeIf { it in 200..1200 } ?: FALLBACK_PAPER_DOTS

/**
 * The Print button. One print at a time: a second tap while printing does
 * nothing. It prints [paper] - the ticket the backend returned, or the same
 * ticket again on a reprint - and nothing else: it never calls the backend,
 * so it can create neither a ticket nor a payment.
 */
class TicketPrintAction(private val printer: TicketPrinter, private val paper: TicketPaper) {
    var busy = false
        private set

    /** False when a print is already running and this tap did nothing. */
    fun press(onOutcome: (TicketPrinter.Outcome) -> Unit): Boolean {
        if (busy) return false
        busy = true
        printer.print(paper) { outcome ->
            busy = false
            onOutcome(outcome)
        }
        return true
    }
}
