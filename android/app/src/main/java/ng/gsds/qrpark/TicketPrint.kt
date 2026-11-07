package ng.gsds.qrpark

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintJob
import android.print.PrintJobInfo
import android.print.PrintManager
import android.print.pdf.PrintedPdfDocument
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.io.FileOutputStream
import java.io.IOException

/**
 * Printing the ticket, behind one interface. The printer is chosen by what
 * the device can do, never by its model: Android's own print system when the
 * device has it (the dialog, then a printer or Save as PDF - the PDF preview
 * on the emulator), otherwise none, and the screen says so. Terminal printing
 * is a later adapter.
 */
interface TicketPrinter {
    enum class Outcome { SENT, CANCELLED, FAILED, NO_PRINTER }

    fun print(paper: TicketPaper, onOutcome: (Outcome) -> Unit)
}

fun choosePrinter(activity: Activity): TicketPrinter =
    if (AndroidTicketPrinter.available(activity)) AndroidTicketPrinter(activity) else NoPrinter

object NoPrinter : TicketPrinter {
    override fun print(paper: TicketPaper, onOutcome: (TicketPrinter.Outcome) -> Unit) = onOutcome(TicketPrinter.Outcome.NO_PRINTER)
}

fun printOutcomeText(outcome: TicketPrinter.Outcome): String = when (outcome) {
    TicketPrinter.Outcome.SENT -> "Sent to the printer."
    TicketPrinter.Outcome.CANCELLED -> "Not printed. Tap Print to try again."
    TicketPrinter.Outcome.FAILED -> "Printing failed. Tap Print to try again."
    TicketPrinter.Outcome.NO_PRINTER -> "This device has no printer service."
}

/**
 * Android printing. Neither the job name nor the PDF's file name carries a
 * token.
 *
 * Copied from eparking 359c0c1 android/pos/.../CounterPrint.kt (CounterPrinter,
 * PaperDocument, PaperArt) and adapted: one paper (the entry ticket), the
 * header's brand and contact lines in place of "E-Parking" and the site name,
 * the job and file names, and the TicketPrinter interface.
 */
class AndroidTicketPrinter(private val activity: Activity) : TicketPrinter {

    private val handler = Handler(Looper.getMainLooper())

    override fun print(paper: TicketPaper, onOutcome: (TicketPrinter.Outcome) -> Unit) {
        val manager = activity.getSystemService(PrintManager::class.java)
            ?: return onOutcome(TicketPrinter.Outcome.NO_PRINTER)
        var job: PrintJob? = null
        val document = PaperDocument(activity, paper) {
            // The dialog has closed; the job says what came of it.
            handler.postDelayed({ onOutcome(outcomeOf(job)) }, SETTLE_MS)
        }
        job = try {
            manager.print(
                "QR Parking ticket",
                document,
                PrintAttributes.Builder().setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME).build(),
            )
        } catch (_: RuntimeException) {
            null
        }
        if (job == null) onOutcome(TicketPrinter.Outcome.FAILED)
    }

    private fun outcomeOf(job: PrintJob?): TicketPrinter.Outcome = when (job?.info?.state) {
        PrintJobInfo.STATE_QUEUED, PrintJobInfo.STATE_STARTED, PrintJobInfo.STATE_COMPLETED -> TicketPrinter.Outcome.SENT
        PrintJobInfo.STATE_FAILED, PrintJobInfo.STATE_BLOCKED -> TicketPrinter.Outcome.FAILED
        // Dismissed before Print, or cancelled.
        else -> TicketPrinter.Outcome.CANCELLED
    }

    companion object {
        private const val SETTLE_MS = 800L

        fun available(context: Context): Boolean =
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_PRINTING) &&
                context.getSystemService(PrintManager::class.java) != null
    }
}

/** One page, drawn fresh for every layout the dialog asks for. */
private class PaperDocument(
    private val context: Context,
    private val paper: TicketPaper,
    private val onFinished: () -> Unit,
) : PrintDocumentAdapter() {

    private var attributes: PrintAttributes? = null

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes,
        cancellationSignal: CancellationSignal,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal.isCanceled) return callback.onLayoutCancelled()
        attributes = newAttributes
        val info = PrintDocumentInfo.Builder("qrpark-ticket.pdf")
            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
            .setPageCount(1)
            .build()
        callback.onLayoutFinished(info, newAttributes != oldAttributes)
    }

    override fun onWrite(
        pages: Array<out PageRange>,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal,
        callback: WriteResultCallback,
    ) {
        val pdf = PrintedPdfDocument(context, attributes ?: return callback.onWriteFailed(null))
        try {
            val page = pdf.startPage(0)
            PaperArt.draw(page.canvas, RectF(page.info.contentRect), paper, PaperArt.logos(context))
            pdf.finishPage(page)
            if (cancellationSignal.isCanceled) return callback.onWriteCancelled()
            // Not closed here: the descriptor belongs to the print system.
            pdf.writeTo(FileOutputStream(destination.fileDescriptor))
            callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (_: IOException) {
            callback.onWriteFailed(null)
        } finally {
            pdf.close()
        }
    }

    override fun onFinish() = onFinished()
}

/** The QR from the token: zxing core, error correction M, a quiet zone of 2 modules. */
object QrCodec {
    fun render(content: String, size: Int): Bitmap {
        val matrix = QRCodeWriter().encode(
            content, BarcodeFormat.QR_CODE, size, size,
            mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2),
        )
        val pixels = IntArray(matrix.width * matrix.height) { i ->
            if (matrix.get(i % matrix.width, i / matrix.width)) Color.BLACK else Color.WHITE
        }
        return Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
    }
}

/**
 * The page: the header (TicketHeader.kt) - GSD left, AIC right, the brand and
 * contact lines between or beneath them - then the QR and the text.
 *
 * Drawn on a 1000-unit-wide grid and scaled to the page: no wider than an
 * 80 mm roll, and smaller if the page is shorter than the paper.
 */
object PaperArt {

    private const val GRID = 1000f
    private const val MAX_WIDTH_PT = 80f / 25.4f * 72f
    private const val LOGO_H = 90f
    private const val BRAND_SIZE = 56f
    private const val BRAND_LINE = 68f
    private const val CONTACT_SIZE = 40f
    private const val CONTACT_LINE = 50f
    private const val QR = 800f

    class Logos(val left: Bitmap?, val right: Bitmap?)

    fun logos(context: Context): Logos = Logos(
        left = BitmapFactory.decodeResource(context.resources, drawableOf(HEADER_LOGO_LEFT)),
        right = BitmapFactory.decodeResource(context.resources, drawableOf(HEADER_LOGO_RIGHT)),
    )

    fun drawableOf(logo: HeaderLogo): Int = when (logo) {
        HeaderLogo.GSD -> R.drawable.gsd_logo
        HeaderLogo.AIC -> R.drawable.aic_logo
    }

    private fun brandPaint() = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK; textSize = BRAND_SIZE; typeface = Typeface.DEFAULT_BOLD; textAlign = Paint.Align.CENTER
    }

    private fun contactPaint() = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK; textSize = CONTACT_SIZE; textAlign = Paint.Align.CENTER
    }

    private fun widthOf(logo: Bitmap?) = logo?.let { LOGO_H * it.width / it.height } ?: 0f

    fun plan(text: HeaderText, logos: Logos): HeaderPlan {
        val brand = brandPaint()
        val contact = contactPaint()
        return headerPlan(
            text,
            middle = GRID - 2 * (maxOf(widthOf(logos.left), widthOf(logos.right)) + 20f),
            full = GRID,
            measureBrand = { brand.measureText(it) },
            measureContact = { contact.measureText(it) },
        )
    }

    private fun textHeight(plan: HeaderPlan) = BRAND_LINE * plan.brandLines.size + CONTACT_LINE * plan.contactLines.size

    private fun headerHeight(plan: HeaderPlan): Float = when (plan.layout) {
        HeaderLayout.INLINE -> maxOf(LOGO_H + 20f, textHeight(plan))
        HeaderLayout.STACKED -> LOGO_H + 20f + textHeight(plan)
    }

    private fun drawHeader(canvas: Canvas, plan: HeaderPlan, logos: Logos) {
        val height = headerHeight(plan)
        val rowH = if (plan.layout == HeaderLayout.INLINE) height else LOGO_H + 20f
        val logoTop = (rowH - LOGO_H) / 2
        logos.left?.let { canvas.drawBitmap(it, null, RectF(0f, logoTop, widthOf(it), logoTop + LOGO_H), null) }
        logos.right?.let { canvas.drawBitmap(it, null, RectF(GRID - widthOf(it), logoTop, GRID, logoTop + LOGO_H), null) }
        var y = when (plan.layout) {
            HeaderLayout.INLINE -> (height - textHeight(plan)) / 2
            HeaderLayout.STACKED -> rowH
        }
        val brand = brandPaint()
        plan.brandLines.forEach { canvas.drawText(it, GRID / 2, y + BRAND_SIZE, brand); y += BRAND_LINE }
        val contact = contactPaint()
        plan.contactLines.forEach { canvas.drawText(it, GRID / 2, y + CONTACT_SIZE, contact); y += CONTACT_LINE }
    }

    fun draw(canvas: Canvas, area: RectF, paper: TicketPaper, logos: Logos) {
        val plan = plan(paper.header, logos)
        val headerH = headerHeight(plan)

        val mono = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK; typeface = Typeface.MONOSPACE; textSize = 40f
        }
        val widest = paper.lines.maxOfOrNull { mono.measureText(it) } ?: 0f
        if (widest > GRID) mono.textSize *= GRID / widest
        val lineH = mono.textSize * 1.3f
        val height = headerH + 30f + QR + 30f + lineH * paper.lines.size

        var scale = minOf(area.width(), MAX_WIDTH_PT) / GRID
        if (height * scale > area.height()) scale = area.height() / height

        canvas.save()
        canvas.translate(area.left + (area.width() - GRID * scale) / 2, area.top)
        canvas.scale(scale, scale)

        drawHeader(canvas, plan, logos)
        var top = headerH + 30f
        canvas.drawBitmap(
            QrCodec.render(paper.qrToken, 640),
            null,
            RectF((GRID - QR) / 2, top, (GRID + QR) / 2, top + QR),
            Paint().apply { isFilterBitmap = false },
        )
        top += QR + 30f

        var y = top + mono.textSize
        for (line in paper.lines) {
            canvas.drawText(line, 0f, y, mono)
            y += lineH
        }
        canvas.restore()
    }
}
