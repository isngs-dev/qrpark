package ng.gsds.qrpark

/** The ticket as POST /tickets and POST /tickets/reprint return it: with the token, to print. */
data class IssuedTicket(
    val id: String,
    val ticketNumber: String,
    /** The QR's content. Held in memory only; never written to disk or logged. */
    val token: String,
    val categoryName: String,
    val feeKobo: Long,
    val issuedAt: String,
    val gateName: String,
    val header: HeaderText,
) {
    /** Never prints the token, so a stray toString() cannot leak it. */
    override fun toString() = "IssuedTicket($ticketNumber)"
}

/** What became of one POST /tickets. */
sealed interface CreateOutcome {
    data class Created(val ticket: IssuedTicket) : CreateOutcome

    /** 400, 403, 404, 409: refused, nothing written. */
    data class Refused(val message: String) : CreateOutcome

    /** 401 after the one refresh: sign in again. */
    data object SignInAgain : CreateOutcome

    /** The backend could not be reached, or the reply was lost. */
    data object NoConnection : CreateOutcome

    /** 5xx, or a reply this app could not read. */
    data object ServerError : CreateOutcome
}

/**
 * [status] is null when there was no reply at all. [ticket] is the parsed
 * body, or null when it could not be read. A ticket is Created only from a
 * 2xx with every field the screen and the paper need.
 */
fun classifyCreate(status: Int?, ticket: IssuedTicket?, message: String): CreateOutcome = when {
    status == null -> CreateOutcome.NoConnection
    status in 200..299 -> if (ticket != null && isComplete(ticket)) CreateOutcome.Created(ticket) else CreateOutcome.ServerError
    status == 401 -> CreateOutcome.SignInAgain
    status in 400..499 -> CreateOutcome.Refused(message)
    else -> CreateOutcome.ServerError
}

private fun isComplete(t: IssuedTicket) =
    t.id.isNotBlank() && t.ticketNumber.isNotBlank() && t.token.isNotBlank()

/** Does this outcome end the attempt (so the next tap gets a new key)? */
fun endsAttempt(outcome: CreateOutcome): Boolean =
    outcome is CreateOutcome.Created || outcome is CreateOutcome.Refused

const val NO_CONNECTION_MESSAGE =
    "Cannot reach the server. No ticket to print yet. Tap New ticket to try again: it will not make a second ticket."
const val SERVER_ERROR_MESSAGE =
    "The server had a problem. No ticket to print yet. Tap New ticket to try again: it will not make a second ticket."

/**
 * The entry screen's New ticket button. One request at a time: a tap while
 * one is in flight sends nothing. The ticket is shown only when the backend
 * returned it.
 */
class NewTicketFlow(private val attempts: EntryAttempts) {

    sealed interface State {
        data object Idle : State
        data class Sending(val attempt: OpenAttempt) : State
        data class Shown(val ticket: IssuedTicket) : State

        /** [attempt] is the one the next tap retries, or null when it ended. */
        data class Failed(val message: String, val attempt: OpenAttempt?) : State
        data object SignIn : State
    }

    var state: State = State.Idle
        private set

    /**
     * The attempt to send now, or null to send nothing: a request is in
     * flight, or there is no open attempt and no category chosen.
     */
    fun tap(username: String, categoryCode: String?): OpenAttempt? {
        if (state is State.Sending) return null
        val attempt = attempts.open(username)
            ?: categoryCode?.takeIf { it.isNotBlank() }?.let { attempts.begin(username, it) }
            ?: return null
        state = State.Sending(attempt)
        return attempt
    }

    fun onOutcome(attempt: OpenAttempt, outcome: CreateOutcome): State {
        attempts.finish(attempt, outcome)
        state = when (outcome) {
            is CreateOutcome.Created -> State.Shown(outcome.ticket)
            is CreateOutcome.Refused -> State.Failed(outcome.message, null)
            CreateOutcome.NoConnection -> State.Failed(NO_CONNECTION_MESSAGE, attempt)
            CreateOutcome.ServerError -> State.Failed(SERVER_ERROR_MESSAGE, attempt)
            CreateOutcome.SignInAgain -> State.SignIn
        }
        return state
    }
}
