package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PaymentAttempts.kt: one idempotency key per cash or card attempt at the
 * booth, stored encrypted with the username, ticket id and method (never a
 * token). Reused on retry and after a restart until the attempt ends; a
 * double tap sends once.
 */
class PaymentAttemptsTest {

    private class Disk : PaymentAttemptStore {
        var saved: OpenPayment? = null
        override fun load() = saved
        override fun save(attempt: OpenPayment) { saved = attempt }
        override fun clear() { saved = null }
    }

    private var n = 0
    private val keys = { "pay-${++n}-0123456789abcdef" }
    private val ticketA = "6f1c2a90-6b1e-4c5d-9a7e-0b2c4d6e8f10"
    private val ticketB = "7a2d3b01-6b1e-4c5d-9a7e-0b2c4d6e8f11"

    @Test
    fun `a new attempt has a fresh key and is stored before it is sent`() {
        val disk = Disk()
        val a = PaymentAttempts(disk).begin("booth-1", ticketA, PayMethod.CASH)
        assertTrue(isValidIdempotencyKey(a.key))
        assertEquals(a, disk.saved)
    }

    @Test
    fun `cash - no connection, a 5xx or a lost session keep the key - so a retry cannot pay twice`() {
        val disk = Disk()
        val p = PaymentAttempts(disk, keys)
        val a = p.begin("booth-1", ticketA, PayMethod.CASH)
        for (o in listOf(PayOutcome.NoConnection, PayOutcome.ServerError, PayOutcome.SignInAgain)) {
            p.finish(a, o)
            assertEquals(o.toString(), a, p.begin("booth-1", ticketA, PayMethod.CASH))
        }
        assertEquals(1, n)
    }

    @Test
    fun `cash - the key survives a restart`() {
        val disk = Disk()
        val a = PaymentAttempts(disk, keys).begin("booth-1", ticketA, PayMethod.CASH)
        val again = PaymentAttempts(disk, keys).apply { onSignedIn("booth-1") }.begin("booth-1", ticketA, PayMethod.CASH)
        assertEquals(a.key, again.key)
    }

    @Test
    fun `a definite answer (2xx or a refusal) ends the attempt`() {
        for (o in listOf(PayOutcome.Done, PayOutcome.Refused)) {
            val disk = Disk()
            val p = PaymentAttempts(disk, keys)
            val a = p.begin("booth-1", ticketA, PayMethod.CASH)
            p.finish(a, o)
            assertNull(o.toString(), disk.saved)
            assertNotEquals(a.key, p.begin("booth-1", ticketA, PayMethod.CASH).key)
        }
    }

    @Test
    fun `card - once the payment exists the key has ended, so Try card again after a cancel gets a NEW key`() {
        val disk = Disk()
        val p = PaymentAttempts(disk, keys)
        val first = p.begin("booth-1", ticketA, PayMethod.CARD)
        p.finish(first, PayOutcome.Done) // the backend made the PENDING payment
        // ... the payment is cancelled at the booth ...
        val again = p.begin("booth-1", ticketA, PayMethod.CARD)
        assertNotEquals("the old key would replay the cancelled payment", first.key, again.key)
    }

    @Test
    fun `card - a lost start reply keeps the key, so the retry replays the same payment`() {
        val disk = Disk()
        val p = PaymentAttempts(disk, keys)
        val first = p.begin("booth-1", ticketA, PayMethod.CARD)
        p.finish(first, PayOutcome.NoConnection)
        assertEquals(first.key, p.begin("booth-1", ticketA, PayMethod.CARD).key)
    }

    @Test
    fun `another ticket or method starts its own attempt`() {
        val disk = Disk()
        val p = PaymentAttempts(disk, keys)
        val cashA = p.begin("booth-1", ticketA, PayMethod.CASH)
        val cardA = p.begin("booth-1", ticketA, PayMethod.CARD)
        assertNotEquals(cashA.key, cardA.key)
        val cashB = p.begin("booth-1", ticketB, PayMethod.CASH)
        assertNotEquals(cardA.key, cashB.key)
        assertEquals(cashB, disk.saved)
    }

    @Test
    fun `another account signing in discards the open attempt, the same account keeps it`() {
        val disk = Disk()
        val a = PaymentAttempts(disk, keys).begin("booth-1", ticketA, PayMethod.CASH)
        PaymentAttempts(disk, keys).onSignedIn("booth-1")
        assertEquals(a, disk.saved)
        PaymentAttempts(disk, keys).onSignedIn("booth-2")
        assertNull(disk.saved)
    }

    @Test
    fun `the stored attempt holds no token - username, key, ticket id and method only`() {
        assertEquals(
            listOf("key", "method", "ticketId", "username"),
            OpenPayment::class.java.declaredFields.map { it.name }.filter { !it.startsWith("$") }.sorted(),
        )
    }

    // ------------------------------------------------ the in-flight guard

    @Test
    fun `a double tap on Confirm cash sends once`() {
        val disk = Disk()
        val tap = PayTap(PaymentAttempts(disk, keys))
        val first = tap.tap("booth-1", ticketA, PayMethod.CASH)
        assertTrue(first != null)
        assertNull(tap.tap("booth-1", ticketA, PayMethod.CASH))
        assertNull(tap.tap("booth-1", ticketA, PayMethod.CARD))
        tap.answered(first!!, PayOutcome.NoConnection)
        val retry = tap.tap("booth-1", ticketA, PayMethod.CASH)
        assertEquals(first.key, retry!!.key)
        assertFalse(tap.inFlight.not())
    }

    // ------------------------------------------------ classifying a reply

    @Test
    fun `the replies, classified`() {
        assertEquals(PayOutcome.NoConnection, classifyPay(null, false))
        assertEquals(PayOutcome.Done, classifyPay(201, false))
        assertEquals(PayOutcome.Done, classifyPay(200, false))
        assertEquals(PayOutcome.SignInAgain, classifyPay(401, false))
        for (s in listOf(400, 403, 404, 409, 502)) assertEquals("$s", PayOutcome.Refused, classifyPay(s, false))
        assertEquals(PayOutcome.ServerError, classifyPay(500, false))
        assertEquals(PayOutcome.ServerError, classifyPay(503, false))
        // 503 with the payment's id (Paystack did not answer the start): the payment exists, follow it.
        assertEquals(PayOutcome.Done, classifyPay(503, true))
    }
}
