package ng.gsds.qrpark

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * What the exit screen shows (docs/01-flow.md section 3). No Android here
 * (ExitRulesTest).
 *
 * The rule above the others: green "Valid — allow exit" only for the
 * backend's VALID. "Already used — by you" (a retry after a lost reply, the
 * backend's usedByYou) is a clearly different, red screen. No connection, a
 * 503 or any 5xx is a grey "Cannot verify", never Valid; the screen never
 * retries by itself.
 */
enum class ExitTone { GREEN, RED, GREY }

enum class ExitKind { VALID, ALREADY_USED, ALREADY_USED_BY_YOU, EXPIRED, PAYMENT_REQUIRED, NOT_FOUND, INVALID_QR, CANNOT_VERIFY }

data class ExitView(val tone: ExitTone, val title: String, val lines: List<String>, val kind: ExitKind)

const val DO_NOT_LET_OUT = "Do not let the vehicle out on this screen. Tap Validate again when the connection is back."

private val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.UK).withZone(ZoneId.of("Africa/Lagos"))

private fun lagosDate(iso: String?): String = try {
    if (iso == null) "?" else DATE.format(Instant.parse(iso))
} catch (_: DateTimeParseException) {
    "?"
}

/** The answer to Validate (POST /tickets/validate). */
fun exitView(reply: CheckReply): ExitView = when (reply) {
    CheckReply.NoConnection -> ExitView(ExitTone.GREY, "Cannot verify — no connection", listOf(DO_NOT_LET_OUT), ExitKind.CANNOT_VERIFY)
    CheckReply.ServerError, CheckReply.SignInAgain -> ExitView(ExitTone.GREY, "Cannot verify", listOf(DO_NOT_LET_OUT), ExitKind.CANNOT_VERIFY)
    is CheckReply.Refused -> ExitView(ExitTone.GREY, reply.message, listOf(DO_NOT_LET_OUT), ExitKind.CANNOT_VERIFY)
    is CheckReply.Result -> {
        val t = reply.ticket
        val number = (t?.ticketNumber ?: reply.ticketNumber)?.let { "Ticket $it" }
        val at = listOfNotNull(reply.usedAt?.let(::lagosTime), reply.usedGateName?.let { "at $it" }).joinToString(" ")
        when (reply.result) {
            "VALID" -> ExitView(
                ExitTone.GREEN, "Valid — allow exit",
                listOfNotNull(t?.categoryName, t?.paidAt?.let { "Paid ${lagosTime(it)}" }, number), ExitKind.VALID,
            )
            "ALREADY_USED" ->
                if (reply.usedByYou) {
                    ExitView(
                        ExitTone.RED, "Already used — by you",
                        listOfNotNull("You let this vehicle out at $at. Do not let it out again.", number), ExitKind.ALREADY_USED_BY_YOU,
                    )
                } else {
                    val by = reply.usedByName?.let { " by $it" }.orEmpty()
                    ExitView(ExitTone.RED, "Already used", listOfNotNull("Used $at$by", number), ExitKind.ALREADY_USED)
                }
            "EXPIRED" -> ExitView(
                ExitTone.RED, "Expired",
                listOfNotNull("Issued ${lagosDate(t?.issuedAt)} — valid on that day only", number), ExitKind.EXPIRED,
            )
            "PAYMENT_REQUIRED" -> ExitView(ExitTone.RED, "Payment required — go to the payment booth", listOfNotNull(number), ExitKind.PAYMENT_REQUIRED)
            "NOT_FOUND" -> ExitView(ExitTone.RED, "Ticket not found", emptyList(), ExitKind.NOT_FOUND)
            "INVALID_QR" -> ExitView(ExitTone.RED, "Not one of our tickets", emptyList(), ExitKind.INVALID_QR)
            else -> ExitView(ExitTone.GREY, "Cannot verify", listOf(DO_NOT_LET_OUT), ExitKind.CANNOT_VERIFY)
        }
    }
}

/**
 * The exit screen's requests: one at a time (Validate or Check), and never a
 * retry by itself. After a grey "Cannot verify" the operator taps Validate
 * again; the backend then answers "Already used — by you" if the first one
 * went through (its usedByYou rule).
 */
class ExitFlow {
    var inFlight = false
        private set

    /** Always null: the screen queues no automatic retry. Kept so a test can say so. */
    val pendingRetry: String? = null

    fun tapValidate(scanned: String): Boolean = start(scanned)

    fun tapCheck(scanned: String): Boolean = start(scanned)

    private fun start(scanned: String): Boolean {
        if (inFlight || scanned.isBlank()) return false
        inFlight = true
        return true
    }

    fun onReply(reply: CheckReply): ExitView {
        inFlight = false
        return exitView(reply)
    }

    /** The answer to a Check: done, nothing more. */
    fun onCheckReply() {
        inFlight = false
    }

    /** Keep the (masked) scan in the field only after "Cannot verify", for Validate again. */
    fun keepsField(view: ExitView): Boolean = view.kind == ExitKind.CANNOT_VERIFY

    fun next() {
        inFlight = false
    }
}
