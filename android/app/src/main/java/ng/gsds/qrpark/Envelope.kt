package ng.gsds.qrpark

import java.security.GeneralSecurityException
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The key that seals stored values: a non-exportable Android Keystore key on a device, a fake in tests. */
interface KeyProvider {
    fun key(): SecretKey
}

/**
 * Seals one stored value: AES-256-GCM with a fresh random IV for every write
 * (the cipher makes it), the slot's name bound in as associated data so a
 * value cannot be moved to another slot, and the tag checked on every read.
 *
 * Sealed form, Base64: version (1 byte) | IV (12) | ciphertext | tag (16).
 * A value that does not open (changed, truncated, another key or slot) reads
 * as absent: never thrown, never logged.
 */
class Envelope(private val keys: KeyProvider) {

    fun seal(slot: String, plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, keys.key())
        val iv = cipher.iv
        check(iv != null && iv.size == IV_BYTES) { "unexpected IV" }
        cipher.updateAAD(slot.toByteArray(Charsets.UTF_8))
        val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(byteArrayOf(VERSION) + iv + sealed)
    }

    fun open(slot: String, sealed: String): String? = try {
        val raw = Base64.getDecoder().decode(sealed)
        if (raw.size < 1 + IV_BYTES + TAG_BYTES || raw[0] != VERSION) {
            null
        } else {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, keys.key(), GCMParameterSpec(TAG_BYTES * 8, raw, 1, IV_BYTES))
            cipher.updateAAD(slot.toByteArray(Charsets.UTF_8))
            String(cipher.doFinal(raw, 1 + IV_BYTES, raw.size - 1 - IV_BYTES), Charsets.UTF_8)
        }
    } catch (_: GeneralSecurityException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val VERSION: Byte = 1
        const val IV_BYTES = 12
        const val TAG_BYTES = 16
    }
}
