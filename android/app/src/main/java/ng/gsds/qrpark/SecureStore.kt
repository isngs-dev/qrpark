package ng.gsds.qrpark

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * The only place this app writes to disk. Every value is sealed (Envelope.kt)
 * with a key that lives in the Android Keystore and never leaves it.
 *
 * The slots are fixed. There is no slot for a ticket, its token, a scanned
 * code or a checkout address: those are held in memory only (TicketHolder,
 * ScanHand, the booth screen), and a ticket or payment lost to a crash is
 * replayed by the backend from the stored idempotency key.
 */
class SecureStore(context: Context, keys: KeyProvider = KeystoreKeys) {

    enum class Slot { ACCESS, REFRESH, USERNAME, NAME, ROLE, GATE_CODE, GATE_NAME, GATE_KIND, SITE_NAME, ATTEMPT, PAY_ATTEMPT, DEVICE_ID }

    private val prefs = context.applicationContext.getSharedPreferences("qrpark_secure", Context.MODE_PRIVATE)
    private val envelope = Envelope(keys)

    operator fun get(slot: Slot): String? =
        prefs.getString(slot.name, null)?.let { envelope.open(slot.name, it) }

    /** Written at once (commit), so an attempt's key is on disk before its request is sent. */
    operator fun set(slot: Slot, value: String?) {
        val edit = prefs.edit()
        if (value == null) edit.remove(slot.name) else edit.putString(slot.name, envelope.seal(slot.name, value))
        edit.commit()
    }

    fun clear(slots: Collection<Slot>) {
        val edit = prefs.edit()
        slots.forEach { edit.remove(it.name) }
        edit.commit()
    }
}

/**
 * An AES-256 key in the Android Keystore, made on first use, for GCM only.
 * Keystore keys cannot be exported; the platform makes a fresh random IV for
 * every encryption (randomised encryption is required).
 */
object KeystoreKeys : KeyProvider {
    private const val ALIAS = "qrpark.store.v1"
    private var cached: SecretKey? = null

    @Synchronized
    override fun key(): SecretKey {
        cached?.let { return it }
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = (keyStore.getKey(ALIAS, null) as? SecretKey) ?: KeyGenerator
            .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .setRandomizedEncryptionRequired(true)
                        .build(),
                )
            }
            .generateKey()
        cached = key
        return key
    }
}

/** The open entry attempt, kept in the encrypted store. */
class StoredAttempt(private val store: SecureStore) : AttemptStore {
    override fun load(): OpenAttempt? {
        val parts = store[SecureStore.Slot.ATTEMPT]?.split('\n') ?: return null
        if (parts.size != 3 || !isValidIdempotencyKey(parts[1])) return null
        return OpenAttempt(username = parts[0], key = parts[1], categoryCode = parts[2])
    }

    override fun save(attempt: OpenAttempt) {
        store[SecureStore.Slot.ATTEMPT] = listOf(attempt.username, attempt.key, attempt.categoryCode).joinToString("\n")
    }

    override fun clear() {
        store[SecureStore.Slot.ATTEMPT] = null
    }
}

/** The open booth payment attempt (ticket id and method, never a token), in the encrypted store. */
class StoredPayment(private val store: SecureStore) : PaymentAttemptStore {
    override fun load(): OpenPayment? {
        val parts = store[SecureStore.Slot.PAY_ATTEMPT]?.split('\n') ?: return null
        if (parts.size != 4 || !isValidIdempotencyKey(parts[1])) return null
        val method = PayMethod.values().firstOrNull { it.name == parts[3] } ?: return null
        return OpenPayment(username = parts[0], key = parts[1], ticketId = parts[2], method = method)
    }

    override fun save(attempt: OpenPayment) {
        store[SecureStore.Slot.PAY_ATTEMPT] = listOf(attempt.username, attempt.key, attempt.ticketId, attempt.method.name).joinToString("\n")
    }

    override fun clear() {
        store[SecureStore.Slot.PAY_ATTEMPT] = null
    }
}
