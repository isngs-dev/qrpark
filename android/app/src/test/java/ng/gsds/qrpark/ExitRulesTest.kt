package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ExitRules.kt: what the exit screen shows (docs/01-flow.md section 3). Green
 * "Valid — allow exit" only for the backend's VALID; "Already used — by you"
 * is a clearly different screen; no connection, 503 or 5xx is a grey
 * "Cannot verify"; the screen never retries by itself.
 */
class ExitRulesTest {

    private fun t(state: String = "PAID") = BoothTicket(
        id = "6f1c2a90-6b1e-4c5d-9a7e-0b2c4d6e8f10", ticketNumber = "K7MP-3QZ9", categoryName = "Car",
        feeKobo = 50_000, issuedAt = "2026-11-06T09:05:00Z", state = state, paymentMethod = "CASH",
        paidAt = "2026-11-07T13:20:00Z",
    )

    private fun r(result: String, ticket: BoothTicket? = t(), byYou: Boolean = false) = CheckReply.Result(
        result = result, ticketNumber = ticket?.ticketNumber, usedAt = "2026-11-07T15:00:00Z",
        usedGateName = "Exit 1", usedByName = "Ada", usedByYou = byYou, ticket = ticket,
    )

    // ------------------------------------------------ each result

    @Test
    fun `VALID - green, allow exit, with the vehicle type and the paid time`() {
        val v = exitView(r("VALID", t("VALIDATED")))
        assertEquals(ExitKind.VALID, v.kind)
        assertEquals(ExitTone.GREEN, v.tone)
        assertEquals("Valid — allow exit", v.title)
        assertEquals(listOf("Car", "Paid 07 Nov 2026 14:20", "Ticket K7MP-3QZ9"), v.lines)
    }

    @Test
    fun `ALREADY_USED - red, with when, which gate and which operator`() {
        val v = exitView(r("ALREADY_USED"))
        assertEquals(ExitKind.ALREADY_USED, v.kind)
        assertEquals(ExitTone.RED, v.tone)
        assertEquals("Already used", v.title)
        assertEquals(listOf("Used 07 Nov 2026 16:00 at Exit 1 by Ada", "Ticket K7MP-3QZ9"), v.lines)
    }

    @Test
    fun `ALREADY_USED by this operator - a clearly different screen from Valid`() {
        val byYou = exitView(r("ALREADY_USED", byYou = true))
        val valid = exitView(r("VALID", t("VALIDATED")))
        assertEquals(ExitKind.ALREADY_USED_BY_YOU, byYou.kind)
        assertEquals(ExitTone.RED, byYou.tone)
        assertEquals("Already used — by you", byYou.title)
        assertEquals(listOf("You let this vehicle out at 07 Nov 2026 16:00 at Exit 1. Do not let it out again.", "Ticket K7MP-3QZ9"), byYou.lines)
        assertNotEquals(valid.tone, byYou.tone)
        assertNotEquals(valid.title, byYou.title)
        assertFalse(byYou.title.contains("Valid"))
    }

    @Test
    fun `EXPIRED - red, with the issue date`() {
        val v = exitView(r("EXPIRED", t("EXPIRED")))
        assertEquals(ExitKind.EXPIRED, v.kind)
        assertEquals(ExitTone.RED, v.tone)
        assertEquals("Expired", v.title)
        assertEquals(listOf("Issued 06 Nov 2026 — valid on that day only", "Ticket K7MP-3QZ9"), v.lines)
    }

    @Test
    fun `PAYMENT_REQUIRED, NOT_FOUND and INVALID_QR - red, plain words`() {
        assertEquals(ExitView(ExitTone.RED, "Payment required — go to the payment booth", listOf("Ticket K7MP-3QZ9"), ExitKind.PAYMENT_REQUIRED), exitView(r("PAYMENT_REQUIRED", t("UNPAID"))))
        assertEquals(ExitView(ExitTone.RED, "Ticket not found", emptyList(), ExitKind.NOT_FOUND), exitView(r("NOT_FOUND", null)))
        assertEquals(ExitView(ExitTone.RED, "Not one of our tickets", emptyList(), ExitKind.INVALID_QR), exitView(r("INVALID_QR", null)))
    }

    @Test
    fun `no connection, 503, 5xx and a lost session are a grey Cannot verify`() {
        assertEquals(ExitView(ExitTone.GREY, "Cannot verify — no connection", listOf(DO_NOT_LET_OUT), ExitKind.CANNOT_VERIFY), exitView(CheckReply.NoConnection))
        assertEquals(ExitView(ExitTone.GREY, "Cannot verify", listOf(DO_NOT_LET_OUT), ExitKind.CANNOT_VERIFY), exitView(CheckReply.ServerError))
        assertEquals(ExitKind.CANNOT_VERIFY, exitView(CheckReply.SignInAgain).kind)
        assertEquals(ExitView(ExitTone.GREY, "Bad location", listOf(DO_NOT_LET_OUT), ExitKind.CANNOT_VERIFY), exitView(CheckReply.Refused("Bad location")))
    }

    // ------------------------------------------------ never Valid by mistake

    @Test
    fun `green and Valid only for VALID - never for anything else`() {
        val others = listOf(
            CheckReply.NoConnection, CheckReply.ServerError, CheckReply.SignInAgain, CheckReply.Refused("x"),
            r("ACTIVE"), r("valid"), r("VALIDATED"), r(""), r("ALREADY_USED", byYou = true), r("ALREADY_USED"),
            r("EXPIRED"), r("PAYMENT_REQUIRED"), r("NOT_FOUND"), r("INVALID_QR"), r("SOMETHING_NEW"),
        )
        for (reply in others) {
            val v = exitView(reply)
            assertNotEquals(reply.toString(), ExitTone.GREEN, v.tone)
            assertFalse(reply.toString(), v.title.startsWith("Valid"))
            assertNotEquals(reply.toString(), ExitKind.VALID, v.kind)
        }
    }

    @Test
    fun `a result this screen does not know is a grey Cannot verify`() {
        for (s in listOf("ACTIVE", "SOMETHING_NEW", "")) {
            assertEquals(s, ExitKind.CANNOT_VERIFY, exitView(r(s)).kind)
        }
    }

    // ------------------------------------------------ the lost reply, retried by the operator

    @Test
    fun `a lost reply then a second tap by the operator - grey first, then Already used by you, never Valid`() {
        val flow = ExitFlow()
        assertTrue(flow.tapValidate("scanned-token"))
        // The backend validated it, but the reply was lost.
        val first = flow.onReply(CheckReply.NoConnection)
        assertEquals(ExitKind.CANNOT_VERIFY, first.kind)
        // The screen does not retry by itself: nothing is in flight, and nothing is queued.
        assertFalse(flow.inFlight)
        assertNull(flow.pendingRetry)
        // The field keeps the scan, so the operator can tap Validate again.
        assertTrue(flow.keepsField(first))
        assertTrue(flow.tapValidate("scanned-token"))
        val second = flow.onReply(r("ALREADY_USED", byYou = true))
        assertEquals(ExitKind.ALREADY_USED_BY_YOU, second.kind)
        assertNotEquals(ExitTone.GREEN, second.tone)
    }

    // ------------------------------------------------ one request at a time, Next

    @Test
    fun `one Validate at a time - taps while one is in flight send nothing`() {
        val flow = ExitFlow()
        assertTrue(flow.tapValidate("code-123456"))
        assertFalse(flow.tapValidate("code-123456"))
        assertFalse(flow.tapCheck("code-123456"))
        flow.onReply(r("VALID", t("VALIDATED")))
        assertTrue(flow.tapValidate("code-123456"))
    }

    @Test
    fun `nothing to validate sends nothing`() {
        val flow = ExitFlow()
        assertFalse(flow.tapValidate(""))
        assertFalse(flow.tapValidate("   "))
        assertFalse(flow.inFlight)
    }

    @Test
    fun `a definite result clears the field, Cannot verify keeps it, Next clears all`() {
        val flow = ExitFlow()
        assertFalse(flow.keepsField(exitView(r("VALID", t("VALIDATED")))))
        assertFalse(flow.keepsField(exitView(r("ALREADY_USED", byYou = true))))
        assertFalse(flow.keepsField(exitView(r("INVALID_QR", null))))
        assertTrue(flow.keepsField(exitView(CheckReply.NoConnection)))
        assertTrue(flow.keepsField(exitView(CheckReply.ServerError)))
        flow.tapValidate("x".repeat(20))
        flow.next()
        assertFalse(flow.inFlight)
    }

    // ------------------------------------------------ Check at the exit (read-only)

    @Test
    fun `Check at the exit uses the read-only words and is never Valid`() {
        val active = checkView(r("ACTIVE", t("PAID")))
        assertEquals("Paid — not used, valid today", active.title)
        assertFalse(active.title.contains("Valid"))
        val flow = ExitFlow()
        assertTrue(flow.tapCheck("code-123456"))
        assertFalse(flow.tapValidate("code-123456"))
    }
}
