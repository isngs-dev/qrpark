package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Envelope.kt: how a stored value is sealed (AES-256-GCM, a fresh random IV
 * per write, the tag checked, the slot name bound in). On a device the key is
 * a non-exportable Android Keystore key; here a fake provider hands the same
 * logic an ordinary AES key.
 */
class EnvelopeTest {

    private class FakeKeys(private val key: SecretKey = newKey()) : KeyProvider {
        override fun key() = key
    }

    private val envelope = Envelope(FakeKeys())

    @Test
    fun `a sealed value opens to itself`() {
        for (plain in listOf("", "a", "refresh.token.value", "₦ unicode ✓", "x".repeat(5000))) {
            assertEquals(plain, envelope.open("slot", envelope.seal("slot", plain)))
        }
    }

    @Test
    fun `the sealed form does not contain the value`() {
        val sealed = envelope.seal("slot", "PLAINTEXT-SECRET-VALUE")
        assertTrue(!sealed.contains("PLAINTEXT"))
        assertTrue(!String(Base64.getDecoder().decode(sealed), Charsets.ISO_8859_1).contains("PLAINTEXT"))
    }

    @Test
    fun `every write uses a fresh random IV`() {
        val seals = (1..50).map { envelope.seal("slot", "same value") }
        assertEquals("sealed forms all differ", 50, seals.toSet().size)
        val ivs = seals.map { Base64.getDecoder().decode(it).copyOfRange(1, 1 + Envelope.IV_BYTES).toList() }
        assertEquals("IVs all differ", 50, ivs.toSet().size)
    }

    @Test
    fun `any changed byte is refused (the GCM tag is checked)`() {
        val sealed = Base64.getDecoder().decode(envelope.seal("slot", "value"))
        for (i in sealed.indices) {
            val bent = sealed.copyOf().also { it[i] = (it[i].toInt() xor 0x01).toByte() }
            assertNull("byte $i", envelope.open("slot", Base64.getEncoder().encodeToString(bent)))
        }
    }

    @Test
    fun `a value sealed for one slot does not open in another`() {
        val sealed = envelope.seal("accessToken", "value")
        assertNull(envelope.open("refreshToken", sealed))
    }

    @Test
    fun `another key cannot open it`() {
        val sealed = envelope.seal("slot", "value")
        assertNull(Envelope(FakeKeys()).open("slot", sealed))
    }

    @Test
    fun `truncated, empty, foreign or garbled input is refused, never thrown`() {
        val sealed = envelope.seal("slot", "value")
        for (bad in listOf("", "%%%", "AAAA", sealed.dropLast(4), sealed.take(10), Base64.getEncoder().encodeToString(ByteArray(40)))) {
            assertNull("'$bad'", envelope.open("slot", bad))
        }
    }

    @Test
    fun `the format version is checked`() {
        val raw = Base64.getDecoder().decode(envelope.seal("slot", "value"))
        assertEquals(Envelope.VERSION, raw[0])
        raw[0] = 9
        assertNull(envelope.open("slot", Base64.getEncoder().encodeToString(raw)))
    }

    @Test
    fun `the sealed form is version, a 12-byte IV, then ciphertext and a 16-byte tag`() {
        val raw = Base64.getDecoder().decode(envelope.seal("slot", "12345"))
        assertEquals(1 + 12 + 5 + 16, raw.size)
        assertNotEquals(0, raw.copyOfRange(1, 13).sumOf { it.toInt() and 0xff })
    }

    private companion object {
        fun newKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    }
}
