package ng.gsds.qrpark

/** What came back from POST /tickets/check. */
sealed interface CheckReply {
    data class Result(
        val result: String,
        val ticketNumber: String? = null,
        val feeKobo: Long? = null,
        val usedAt: String? = null,
        val usedGateName: String? = null,
        val usedByName: String? = null,
        val usedByYou: Boolean = false,
        /** The ticket summary (never the token); the booth acts on its id. */
        val ticket: BoothTicket? = null,
    ) : CheckReply

    /** 400: the backend's message (for example the location does not allow it). */
    data class Refused(val message: String) : CheckReply

    data object NoConnection : CheckReply

    /** 401 after the one refresh: sign in again. */
    data object SignInAgain : CheckReply

    /** 503 "Cannot verify", any other 5xx, or a reply this app could not read. */
    data object ServerError : CheckReply
}

/** GOOD and BAD are states of a ticket; GREY means nothing could be decided. */
enum class Tone { GOOD, BAD, GREY }

data class CheckView(val tone: Tone, val title: String, val detail: String?)

/**
 * The words on the Check screen (docs/api.md, scans). A check is read-only and
 * never says "Valid": a result this app does not know, VALID included, is a
 * grey "Cannot verify".
 */
fun checkView(reply: CheckReply): CheckView = when (reply) {
    CheckReply.NoConnection -> CheckView(Tone.GREY, "Cannot verify — no connection", null)
    CheckReply.ServerError, CheckReply.SignInAgain -> CheckView(Tone.GREY, "Cannot verify", null)
    is CheckReply.Refused -> CheckView(Tone.GREY, reply.message, null)
    is CheckReply.Result -> {
        val number = reply.ticketNumber?.let { "Ticket $it" }
        when (reply.result) {
            "ACTIVE" -> CheckView(Tone.GOOD, "Paid — not used, valid today", join(number, reply.feeKobo?.let(::naira)))
            "PAYMENT_REQUIRED" -> CheckView(Tone.BAD, "Payment required — go to the payment booth", join(number, reply.feeKobo?.let(::naira)))
            "ALREADY_USED" -> CheckView(Tone.BAD, "Already used", join(usedLine(reply), number))
            "EXPIRED" -> CheckView(Tone.BAD, "Expired", join("Issued on an earlier day", number))
            "NOT_FOUND" -> CheckView(Tone.BAD, "Ticket not found", null)
            "INVALID_QR" -> CheckView(Tone.BAD, "Not one of our tickets", null)
            else -> CheckView(Tone.GREY, "Cannot verify", null)
        }
    }
}

private fun usedLine(r: CheckReply.Result): String {
    val parts = mutableListOf("Used")
    r.usedAt?.let { parts += lagosTime(it) }
    r.usedGateName?.let { parts += "at $it" }
    when {
        r.usedByYou -> parts += "by you"
        r.usedByName != null -> parts += "by ${r.usedByName}"
    }
    return parts.joinToString(" ")
}

private fun join(vararg parts: String?): String? =
    parts.filterNotNull().filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { null }
