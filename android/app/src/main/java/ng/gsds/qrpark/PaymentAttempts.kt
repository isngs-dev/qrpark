package ng.gsds.qrpark

/**
 * One cash or card attempt at the booth: its idempotency key, the ticket's id
 * (never its token), the method and the account. Stored encrypted
 * (SecureStore) so a retry and a restart send the same key: the backend then
 * returns the first payment instead of taking a second one.
 */
enum class PayMethod { CASH, CARD }

data class OpenPayment(val username: String, val key: String, val ticketId: String, val method: PayMethod)

interface PaymentAttemptStore {
    fun load(): OpenPayment?
    fun save(attempt: OpenPayment)
    fun clear()
}

/** What one POST /payments/cash or /payments/card came to, for the key. */
enum class PayOutcome {
    /** 2xx (the payment exists), or a 503 that names the payment it made. */
    Done,

    /** 4xx or 502: refused, nothing (more) to replay. */
    Refused,
    SignInAgain,
    NoConnection,
    ServerError,
}

/** [namesPayment]: the body carries the payment's id (a card start Paystack did not answer). */
fun classifyPay(status: Int?, namesPayment: Boolean): PayOutcome = when {
    status == null -> PayOutcome.NoConnection
    status in 200..299 -> PayOutcome.Done
    status == 401 -> PayOutcome.SignInAgain
    status in 400..499 || status == 502 -> PayOutcome.Refused
    status == 503 && namesPayment -> PayOutcome.Done
    else -> PayOutcome.ServerError
}

/**
 * The key lifecycle (as at entry): a new key for every new attempt, the same
 * key on every retry and after a restart until a definite answer. A card
 * attempt ends as soon as its payment exists (2xx), so "Try card again" after
 * a cancel, a failure or an abandon always gets a NEW key (the old one would
 * replay the old payment). Another account signing in discards it.
 */
class PaymentAttempts(
    private val store: PaymentAttemptStore,
    private val newKey: () -> String = ::newIdempotencyKey,
) {
    fun onSignedIn(username: String) {
        val open = store.load() ?: return
        if (open.username != username) store.clear()
    }

    fun begin(username: String, ticketId: String, method: PayMethod): OpenPayment {
        store.load()?.let { if (it.username == username && it.ticketId == ticketId && it.method == method) return it }
        val key = newKey()
        require(isValidIdempotencyKey(key)) { "idempotency key of the wrong shape" }
        return OpenPayment(username, key, ticketId, method).also(store::save)
    }

    fun finish(attempt: OpenPayment, outcome: PayOutcome) {
        if (outcome != PayOutcome.Done && outcome != PayOutcome.Refused) return
        if (store.load()?.key == attempt.key) store.clear()
    }
}

/** One payment request at a time: a tap while one is in flight sends nothing. */
class PayTap(private val attempts: PaymentAttempts) {
    var inFlight = false
        private set

    fun tap(username: String, ticketId: String, method: PayMethod): OpenPayment? {
        if (inFlight) return null
        inFlight = true
        return attempts.begin(username, ticketId, method)
    }

    fun answered(attempt: OpenPayment, outcome: PayOutcome) {
        attempts.finish(attempt, outcome)
        inFlight = false
    }
}
