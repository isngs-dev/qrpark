package ng.gsds.qrpark

import java.net.URI
import java.net.URISyntaxException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * What the booth shows (docs/01-flow.md section 2). No Android here, so the
 * rules run on the JVM (BoothRulesTest).
 *
 * The one rule above the others: "Paid" only on the backend's word - a ticket
 * the backend reports PAID, or a payment it reports SUCCESS with its ticket
 * PAID. No connection, a 5xx, an unknown status or a closed checkout is never
 * "Paid". Every amount is the backend's integer kobo, shown with naira().
 */

/** A ticket summary as the backend sends it (check, lookup, payment). Never a token. */
data class BoothTicket(
    val id: String,
    val ticketNumber: String,
    val categoryName: String,
    val feeKobo: Long,
    val issuedAt: String,
    /** UNPAID, PAID, VALIDATED or EXPIRED. */
    val state: String,
    val paymentMethod: String?,
    val paidAt: String?,
)

sealed interface BoothView {
    data class Paid(val ticket: BoothTicket) : BoothView {
        val line: String
            get() = "Paid" + listOfNotNull(ticket.paymentMethod?.lowercase(Locale.ROOT), ticket.paidAt?.let(::lagosTime))
                .joinToString(", ").let { if (it.isEmpty()) "" else " ($it)" }
    }
    data class TakePayment(val ticket: BoothTicket) : BoothView {
        val button: String get() = "Take payment ${naira(ticket.feeKobo)}"
        val cashButton: String get() = "Confirm ${naira(ticket.feeKobo)} cash received"
    }
    data class AlreadyUsed(val ticket: BoothTicket?) : BoothView
    data class Expired(val ticket: BoothTicket?) : BoothView
    data object NotFound : BoothView
    data object NotOurs : BoothView

    /** Grey: nothing could be decided. Never Paid, never a payment button. */
    data class Problem(val message: String) : BoothView
}

/** A ticket from a lookup (or inside a reply), by the backend's state word. */
fun boothView(t: BoothTicket): BoothView = when (t.state) {
    "PAID" -> BoothView.Paid(t)
    "UNPAID" -> BoothView.TakePayment(t)
    "VALIDATED" -> BoothView.AlreadyUsed(t)
    "EXPIRED" -> BoothView.Expired(t)
    else -> BoothView.Problem("Cannot verify")
}

/** The answer to Check (POST /tickets/check). */
fun boothViewOfCheck(reply: CheckReply): BoothView = when (reply) {
    CheckReply.NoConnection -> BoothView.Problem("Cannot check — no connection")
    CheckReply.ServerError, CheckReply.SignInAgain -> BoothView.Problem("Cannot verify")
    is CheckReply.Refused -> BoothView.Problem(reply.message)
    is CheckReply.Result -> {
        val t = reply.ticket
        when (reply.result) {
            "ACTIVE" -> if (t != null && t.state == "PAID") BoothView.Paid(t) else BoothView.Problem("Cannot verify")
            "PAYMENT_REQUIRED" -> if (t != null && t.state == "UNPAID") BoothView.TakePayment(t) else BoothView.Problem("Cannot verify")
            "ALREADY_USED" -> BoothView.AlreadyUsed(t)
            "EXPIRED" -> BoothView.Expired(t)
            "NOT_FOUND" -> BoothView.NotFound
            "INVALID_QR" -> BoothView.NotOurs
            else -> BoothView.Problem("Cannot verify")
        }
    }
}

// ------------------------------------------------------------------ cash

/** What came back from POST /payments/cash or /payments/card (the start). */
sealed interface PayReply {
    data class Ok(val status: String, val ticket: BoothTicket?, val paymentId: String? = null, val checkoutUrl: String? = null) : PayReply

    /** 4xx (and 502): [pendingPaymentId] when a card payment for this ticket or operator is in progress. */
    data class Refused(val code: Int, val message: String, val pendingPaymentId: String?) : PayReply
    data object SignInAgain : PayReply
    data object NoConnection : PayReply
    data object ServerError : PayReply
}

const val PAY_NO_CONNECTION =
    "Cannot reach the server. Not confirmed. Tap again when the connection is back: the cash is not taken twice."
const val PAY_SERVER_ERROR = "The server had a problem. Not confirmed. Tap again: the cash is not taken twice."

/** Cash: Paid only when the backend answered SUCCESS and the ticket it returned is PAID. */
fun cashView(reply: PayReply): BoothView = when (reply) {
    is PayReply.Ok ->
        if (reply.status == "SUCCESS" && reply.ticket != null && reply.ticket.state == "PAID") BoothView.Paid(reply.ticket)
        else BoothView.Problem("Cannot verify. Check the ticket again.")
    is PayReply.Refused -> BoothView.Problem(reply.message)
    PayReply.SignInAgain -> BoothView.Problem("Your session has ended. Sign in again.")
    PayReply.NoConnection -> BoothView.Problem(PAY_NO_CONNECTION)
    PayReply.ServerError -> BoothView.Problem(PAY_SERVER_ERROR)
}

// ------------------------------------------------------------------ card

/** GET /payments/:id every [POLL_EVERY_MS] while the card payment waits. */
const val POLL_EVERY_MS = 2_500L

/** Cancel payment is offered after this long (the backend enforces 60 s too and says when). */
const val CANCEL_AFTER_MS = 60_000L

/** "Not confirmed yet" after this long. */
const val NOT_CONFIRMED_AFTER_MS = 60_000L

sealed interface PollReply {
    data class Ok(val status: String, val ticket: BoothTicket?) : PollReply
    data object NotFound : PollReply
    data object NoConnection : PollReply
    data object ServerError : PollReply
}

const val CARD_FAILED = "The card payment failed. Choose again: card or cash."
const val CARD_ABANDONED = "The card payment was not completed. Choose again: card or cash."
const val CARD_DUPLICATE = "This ticket was already paid; this card payment is a duplicate. It is refunded in the Paystack dashboard."
const val CARD_CANCELLED = "Card payment cancelled. Choose again: card or cash."
const val CARD_CANCELLED_FORCED = "Card payment cancelled (Paystack could not be reached). Choose again: card or cash."
const val POLL_NO_CONNECTION = "Cannot reach the server. Not confirmed yet; still checking."
const val POLL_SERVER_ERROR = "The server had a problem. Not confirmed yet; still checking."
const val POLL_NOT_FOUND = "This payment is not one of yours. Check the ticket again."

sealed interface CardView {
    data class Waiting(val notConfirmedYet: Boolean, val cancelOffered: Boolean) : CardView {
        val text: String get() = if (notConfirmedYet) "Not confirmed yet — still checking" else "Waiting for Paystack to confirm…"
    }
    data class Paid(val ticket: BoothTicket) : CardView
    data class Ended(val message: String) : CardView
    data class Problem(val message: String, val keepPolling: Boolean) : CardView
}

/** [waitedMs]: how long this screen has been waiting (the device's own uptime clock; never sent anywhere). */
fun cardView(reply: PollReply, waitedMs: Long): CardView = when (reply) {
    is PollReply.Ok -> when (reply.status) {
        "PENDING" -> CardView.Waiting(waitedMs >= NOT_CONFIRMED_AFTER_MS, waitedMs >= CANCEL_AFTER_MS)
        "SUCCESS" ->
            if (reply.ticket != null && reply.ticket.state == "PAID") CardView.Paid(reply.ticket)
            else CardView.Problem(POLL_SERVER_ERROR, keepPolling = true)
        "FAILED" -> CardView.Ended(CARD_FAILED)
        "ABANDONED" -> CardView.Ended(CARD_ABANDONED)
        "DUPLICATE" -> CardView.Ended(CARD_DUPLICATE)
        else -> CardView.Problem(POLL_SERVER_ERROR, keepPolling = true)
    }
    PollReply.NotFound -> CardView.Problem(POLL_NOT_FOUND, keepPolling = false)
    PollReply.NoConnection -> CardView.Problem(POLL_NO_CONNECTION, keepPolling = true)
    PollReply.ServerError -> CardView.Problem(POLL_SERVER_ERROR, keepPolling = true)
}

fun keepsPolling(view: CardView): Boolean = when (view) {
    is CardView.Waiting -> true
    is CardView.Problem -> view.keepPolling
    is CardView.Paid, is CardView.Ended -> false
}

// ------------------------------------------------------------------ cancel

sealed interface CancelReply {
    data class Ok(val outcome: String, val forced: Boolean, val paymentStatus: String, val ticket: BoothTicket?) : CancelReply

    /** 409 before the 60 s: the backend's allowedAt (UTC). */
    data class TooEarly(val allowedAt: String?) : CancelReply

    /** 503: Paystack could not be reached; the operator may confirm a forced cancel. */
    data object CannotConfirm : CancelReply
    data class Refused(val message: String) : CancelReply
    data object NoConnection : CancelReply
    data object ServerError : CancelReply
}

const val CANNOT_CONFIRM_WARNING =
    "Paystack could not be reached, so it cannot be confirmed that the customer has not paid by card. " +
        "Cancel anyway only if the customer did not pay by card."
const val CANCEL_NO_CONNECTION = "Cannot reach the server. The payment is not cancelled; still checking."
const val CANCEL_SERVER_ERROR = "The server had a problem. The payment is not cancelled; still checking."

sealed interface CancelView {
    data class Ended(val message: String) : CancelView
    data class Paid(val ticket: BoothTicket) : CancelView

    /** Not cancelled; the payment keeps waiting (and polling). */
    data class StillWaiting(val message: String) : CancelView

    /** The warning, then a confirm step that sends force:true. */
    data class ConfirmForce(val warning: String) : CancelView
}

private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss", Locale.UK).withZone(ZoneId.of("Africa/Lagos"))

fun cancelView(reply: CancelReply): CancelView = when (reply) {
    is CancelReply.Ok -> when (reply.outcome) {
        "CANCELLED" -> CancelView.Ended(if (reply.forced) CARD_CANCELLED_FORCED else CARD_CANCELLED)
        "ALREADY_PAID" ->
            if (reply.ticket != null && reply.ticket.state == "PAID") CancelView.Paid(reply.ticket)
            else CancelView.StillWaiting("Paystack reports this payment paid. Checking the ticket…")
        "FAILED" -> CancelView.Ended(CARD_FAILED)
        "ALREADY_ENDED" -> CancelView.Ended(if (reply.paymentStatus == "FAILED") CARD_FAILED else CARD_ABANDONED)
        else -> CancelView.StillWaiting(CANCEL_SERVER_ERROR)
    }
    is CancelReply.TooEarly -> CancelView.StillWaiting(
        reply.allowedAt?.let {
            try {
                "Cancel is allowed from ${CLOCK.format(Instant.parse(it))}."
            } catch (_: DateTimeParseException) {
                null
            }
        } ?: "Cancel is not allowed yet.",
    )
    CancelReply.CannotConfirm -> CancelView.ConfirmForce(CANNOT_CONFIRM_WARNING)
    is CancelReply.Refused -> CancelView.StillWaiting(reply.message)
    CancelReply.NoConnection -> CancelView.StillWaiting(CANCEL_NO_CONNECTION)
    CancelReply.ServerError -> CancelView.StillWaiting(CANCEL_SERVER_ERROR)
}

// ------------------------------------------------------------------ checkout

/**
 * The Paystack checkout opens in the system browser only when its address is
 * https on a Paystack host (paystack.com or a subdomain), port 443, with no
 * user part. Anything else is not opened. The address is held in memory
 * only: never stored, never logged.
 */
fun isPaystackCheckout(url: String): Boolean {
    val uri = try {
        URI(url)
    } catch (_: URISyntaxException) {
        return false
    }
    val host = uri.host ?: return false
    return uri.scheme == "https" &&
        uri.rawUserInfo == null &&
        (uri.port == -1 || uri.port == 443) &&
        (host == "paystack.com" || host.endsWith(".paystack.com"))
}

fun checkoutToOpen(url: String?): String? = url?.takeIf(::isPaystackCheckout)
