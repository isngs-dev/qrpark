package ng.gsds.qrpark.nexgo

import android.app.Activity
import android.os.Handler
import android.os.Looper
import com.nexgo.oaf.apiv3.SdkResult
import ng.gsds.qrpark.PaperArt
import ng.gsds.qrpark.TicketPaper
import ng.gsds.qrpark.TicketPrinter
import ng.gsds.qrpark.ticketWidthDots
import ng.gsds.qrpark.vendorPrintOutcome
import com.nexgo.oaf.apiv3.device.printer.AlignEnum
import com.nexgo.oaf.apiv3.device.printer.OnPrintListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The ticket on the Nexgo printer, behind the app's TicketPrinter seam.
 *
 * It prints exactly the paper the ticket screen shows (PaperArt, the same
 * drawing as Android printing): rendered by the app as ONE image at the
 * paper's width and sent as that image. The SDK therefore receives a picture,
 * never the token as text. A reprint is the same paper again (the same QR);
 * this class never calls the backend, so it creates neither a ticket nor a
 * payment.
 *
 * SENT only when every call was accepted and the printer's own callback says
 * Success (vendorPrintOutcome); out of paper, busy, too hot, or no callback
 * within 60 s is FAILED. Nothing is logged; an exception's text is dropped.
 *
 * Adapted from C:\Dev\qrpark-n86-probe PrinterActivity.kt (ProbePrinter.run)
 * and TicketActivity.kt (N86-1): init, status, one image, feed, start, wait
 * for the callback.
 */
class NexgoTicketPrinter(private val activity: Activity) : TicketPrinter {

    private val main = Handler(Looper.getMainLooper())

    override fun print(paper: TicketPaper, onOutcome: (TicketPrinter.Outcome) -> Unit) {
        val engine = NexgoDevice.engine() ?: return onOutcome(TicketPrinter.Outcome.NO_PRINTER)
        val image = PaperArt.render(activity, paper, ticketWidthDots(paperWidthDots()))
        NexgoDevice.sdkThread.execute {
            val outcome = try {
                val printer = engine.printer
                if (printer == null) {
                    TicketPrinter.Outcome.NO_PRINTER
                } else {
                    var accepted = printer.initPrinter() == SdkResult.Success &&
                        printer.status == SdkResult.Success &&
                        printer.appendImage(image, AlignEnum.CENTER) == SdkResult.Success
                    var confirmed: Boolean? = null
                    if (accepted) {
                        printer.feedPaper(FEED_DOTS)
                        val done = CountDownLatch(1)
                        val started = printer.startPrint(true, OnPrintListener { code ->
                            confirmed = code == SdkResult.Success
                            done.countDown()
                        })
                        accepted = started == SdkResult.Success
                        if (accepted && !done.await(CALLBACK_SECONDS, TimeUnit.SECONDS)) confirmed = null
                    }
                    vendorPrintOutcome(accepted, confirmed)
                }
            } catch (_: Throwable) {
                TicketPrinter.Outcome.FAILED
            }
            main.post { onOutcome(outcome) }
        }
    }

    /**
     * The paper's printable width in dots, from the printer. The SDK's
     * printer interface reports no width (N86-1 found no such call), so this
     * is null and ticketWidthDots falls back to 384 dots (58 mm). When a
     * width call is found it belongs here; nothing else changes.
     */
    private fun paperWidthDots(): Int? = null

    private companion object {
        const val FEED_DOTS = 64
        const val CALLBACK_SECONDS = 60L
    }
}
