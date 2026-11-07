package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** CheckView.kt: the check result, in plain words. A check never says "Valid". */
class CheckViewTest {

    private fun result(r: String, usedByYou: Boolean = false) = CheckReply.Result(
        result = r, ticketNumber = "K7MP-3QZ9", feeKobo = 50_000,
        usedAt = "2026-11-07T15:00:00Z", usedGateName = "Exit 1", usedByName = "Ada", usedByYou = usedByYou,
    )

    @Test
    fun `each result has its plain words and tone`() {
        assertEquals(CheckView(Tone.GOOD, "Paid — not used, valid today", "Ticket K7MP-3QZ9 · ₦500.00"), checkView(result("ACTIVE")))
        assertEquals(Tone.BAD, checkView(result("PAYMENT_REQUIRED")).tone)
        assertEquals("Payment required — go to the payment booth", checkView(result("PAYMENT_REQUIRED")).title)
        assertEquals("Already used", checkView(result("ALREADY_USED")).title)
        assertEquals("Used 07 Nov 2026 16:00 at Exit 1 by Ada · Ticket K7MP-3QZ9", checkView(result("ALREADY_USED")).detail)
        assertEquals("Used 07 Nov 2026 16:00 at Exit 1 by you · Ticket K7MP-3QZ9", checkView(result("ALREADY_USED", usedByYou = true)).detail)
        assertEquals("Expired", checkView(result("EXPIRED")).title)
        assertEquals("Issued on an earlier day · Ticket K7MP-3QZ9", checkView(result("EXPIRED")).detail)
        assertEquals(CheckView(Tone.BAD, "Ticket not found", null), checkView(CheckReply.Result("NOT_FOUND")))
        assertEquals(CheckView(Tone.BAD, "Not one of our tickets", null), checkView(CheckReply.Result("INVALID_QR")))
    }

    @Test
    fun `no connection, 503 and 5xx are a grey cannot-verify, never a result`() {
        assertEquals(CheckView(Tone.GREY, "Cannot verify — no connection", null), checkView(CheckReply.NoConnection))
        assertEquals(CheckView(Tone.GREY, "Cannot verify", null), checkView(CheckReply.ServerError))
    }

    @Test
    fun `a check never says valid, whatever comes back`() {
        for (r in listOf("VALID", "", "SOMETHING_NEW", "active")) {
            val v = checkView(CheckReply.Result(r))
            assertEquals(r, Tone.GREY, v.tone)
            assertTrue(r, !v.title.contains("Valid", ignoreCase = true) || v.title.startsWith("Cannot"))
        }
    }

    @Test
    fun `a refusal shows the backend's message`() {
        assertEquals(CheckView(Tone.GREY, "Bad location", null), checkView(CheckReply.Refused("Bad location")))
    }
}
