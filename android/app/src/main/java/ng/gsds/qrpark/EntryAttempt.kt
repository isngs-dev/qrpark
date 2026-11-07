package ng.gsds.qrpark

import java.util.UUID

/**
 * One New ticket attempt: its idempotency key, the category it asked for and
 * the account that started it. Stored encrypted (SecureStore) so a retry and
 * a restart send the same key, and the backend returns the same ticket
 * instead of making a second one.
 *
 * It never holds the ticket's token: that is kept in memory only.
 */
data class OpenAttempt(val username: String, val key: String, val categoryCode: String)

/** Where the open attempt is kept: the encrypted store on a device, a fake in tests. */
interface AttemptStore {
    fun load(): OpenAttempt?
    fun save(attempt: OpenAttempt)
    fun clear()
}

private val KEY_SHAPE = Regex("^[A-Za-z0-9_-]{16,100}$")

/** The backend's rule for an idempotency key (docs/api.md): 16-100 of A-Z a-z 0-9 _ -. */
fun isValidIdempotencyKey(key: String): Boolean = KEY_SHAPE.matches(key)

/** A random UUID (122 random bits from a secure generator), 36 characters. */
fun newIdempotencyKey(): String = UUID.randomUUID().toString()

/**
 * The lifecycle: a new key for every new attempt; the same key on every retry
 * and after a restart until the attempt ends. It ends when the ticket is
 * received, or on a definite refusal (400, 403, 404, 409: the backend wrote
 * nothing). No connection, a server error or a lost session keep it.
 *
 * The attempt belongs to the account that started it: when a different
 * account signs in it is discarded; the same account (after a 401 or a
 * restart) keeps it.
 */
class EntryAttempts(
    private val store: AttemptStore,
    private val newKey: () -> String = ::newIdempotencyKey,
) {
    /** Call on every sign-in and when the app starts signed in. */
    fun onSignedIn(username: String) {
        val open = store.load() ?: return
        if (open.username != username) store.clear()
    }

    /** The open attempt of [username], or null. */
    fun open(username: String): OpenAttempt? = store.load()?.takeIf { it.username == username }

    /**
     * The attempt to send: the open one if there is one (with ITS category,
     * whatever is chosen now), otherwise a new one for [categoryCode], stored
     * before anything is sent.
     */
    fun begin(username: String, categoryCode: String): OpenAttempt {
        open(username)?.let { return it }
        val key = newKey()
        require(isValidIdempotencyKey(key)) { "idempotency key of the wrong shape" }
        return OpenAttempt(username, key, categoryCode).also(store::save)
    }

    /** Ends [attempt] when [outcome] ends it, and only if it is still the open one. */
    fun finish(attempt: OpenAttempt, outcome: CreateOutcome) {
        if (!endsAttempt(outcome)) return
        if (store.load()?.key == attempt.key) store.clear()
    }
}
