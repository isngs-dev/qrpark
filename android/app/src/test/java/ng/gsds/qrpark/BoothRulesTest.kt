package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BoothRules.kt: what the booth shows. "Paid" only on the backend's word (a
 * PAID ticket, or a payment the backend says is SUCCESS); no connection, a
 * 5xx or anything unknown is never "Paid".
 */
class BoothRulesTest {

    private fun ticket(state: String, method: String? = null) = BoothTicket(
        id = "6f1c2a90-6b1e-4c5d-9a7e-0b2c4d6e8f10", ticketNumber = "K7MP-3QZ9", categoryName = "Car",
        feeKobo = 50_000, issuedAt = "2026-11-07T13:05:00Z", state = state, paymentMethod = method,
        paidAt = if (state == "PAID") "2026-11-07T13:20:00Z" else null,
    )

    private fun isPaid(v: BoothView) = v is BoothView.Paid

    // ------------------------------------------------ a ticket, by lookup or check

    @Test
    fun `a looked-up ticket shows Paid, Already used, Expired, or Take payment with the backend's fee`() {
        assertEquals(BoothView.Paid(ticket("PAID", "CASH")), boothView(ticket("PAID", "CASH")))
        assertEquals("Paid (cash, 07 Nov 2026 14:20)", (boothView(ticket("PAID", "CASH")) as BoothView.Paid).line)
        assertEquals(BoothView.AlreadyUsed(ticket("VALIDATED")), boothView(ticket("VALIDATED")))
        assertEquals(BoothView.Expired(ticket("EXPIRED")), boothView(ticket("EXPIRED")))
        val take = boothView(ticket("UNPAID"))
        assertEquals(BoothView.TakePayment(ticket("UNPAID")), take)
        assertEquals("Take payment ₦500.00", (take as BoothView.TakePayment).button)
        assertEquals("Confirm ₦500.00 cash received", take.cashButton)
    }

    @Test
    fun `an unknown ticket state is never Paid and offers no payment`() {
        for (s in listOf("", "paid", "SOMETHING")) {
            val v = boothView(ticket(s))
            assertFalse(s, isPaid(v))
            assertTrue(s, v is BoothView.Problem)
        }
    }

    @Test
    fun `a check result maps to the same views, Paid only for ACTIVE`() {
        val t = ticket("UNPAID")
        assertTrue(isPaid(boothViewOfCheck(CheckReply.Result("ACTIVE", ticket = ticket("PAID", "CARD")))))
        assertEquals(BoothView.TakePayment(t), boothViewOfCheck(CheckReply.Result("PAYMENT_REQUIRED", ticket = t)))
        assertTrue(boothViewOfCheck(CheckReply.Result("ALREADY_USED", ticket = ticket("VALIDATED"))) is BoothView.AlreadyUsed)
        assertTrue(boothViewOfCheck(CheckReply.Result("EXPIRED", ticket = ticket("EXPIRED"))) is BoothView.Expired)
        assertEquals(BoothView.NotFound, boothViewOfCheck(CheckReply.Result("NOT_FOUND")))
        assertEquals(BoothView.NotOurs, boothViewOfCheck(CheckReply.Result("INVALID_QR")))
        // VALID (an exit result), a result we do not know, or a result without its ticket.
        // ACTIVE with a ticket that is not PAID is a contradiction: never shown as Paid.
        for (r in listOf(CheckReply.Result("VALID", ticket = t), CheckReply.Result("NEW_THING", ticket = t), CheckReply.Result("PAYMENT_REQUIRED"), CheckReply.Result("ACTIVE"), CheckReply.Result("ACTIVE", ticket = t))) {
            val v = boothViewOfCheck(r)
            assertFalse(r.toString(), isPaid(v))
            assertTrue(r.toString(), v is BoothView.Problem)
        }
    }

    @Test
    fun `no connection and server errors on a check are never Paid`() {
        assertEquals(BoothView.Problem("Cannot check — no connection"), boothViewOfCheck(CheckReply.NoConnection))
        assertEquals(BoothView.Problem("Cannot verify"), boothViewOfCheck(CheckReply.ServerError))
        assertEquals(BoothView.Problem("Bad location"), boothViewOfCheck(CheckReply.Refused("Bad location")))
    }

    // ------------------------------------------------ cash

    @Test
    fun `cash shows Paid only when the backend answered SUCCESS with the ticket PAID`() {
        val paid = ticket("PAID", "CASH")
        assertTrue(isPaid(cashView(PayReply.Ok(status = "SUCCESS", ticket = paid))))
        assertFalse(isPaid(cashView(PayReply.Ok(status = "PENDING", ticket = paid))))
        assertFalse(isPaid(cashView(PayReply.Ok(status = "SUCCESS", ticket = ticket("UNPAID")))))
        assertFalse(isPaid(cashView(PayReply.Ok(status = "SUCCESS", ticket = null))))
        assertFalse(isPaid(cashView(PayReply.NoConnection)))
        assertFalse(isPaid(cashView(PayReply.ServerError)))
        assertFalse(isPaid(cashView(PayReply.Refused(409, "Ticket is already paid", null))))
        assertEquals(BoothView.Problem(PAY_NO_CONNECTION), cashView(PayReply.NoConnection))
        assertTrue(PAY_NO_CONNECTION.contains("not taken twice"))
    }

    // ------------------------------------------------ card: polling

    @Test
    fun `every poll state, from the backend's payment status`() {
        assertEquals(CardView.Waiting(notConfirmedYet = false, cancelOffered = false), cardView(PollReply.Ok("PENDING", null), waitedMs = 5_000))
        assertEquals(CardView.Waiting(notConfirmedYet = true, cancelOffered = true), cardView(PollReply.Ok("PENDING", null), waitedMs = 60_000))
        assertEquals(CardView.Paid(ticket("PAID", "CARD")), cardView(PollReply.Ok("SUCCESS", ticket("PAID", "CARD")), 1_000))
        assertEquals(CardView.Ended(CARD_FAILED), cardView(PollReply.Ok("FAILED", null), 1_000))
        assertEquals(CardView.Ended(CARD_ABANDONED), cardView(PollReply.Ok("ABANDONED", null), 1_000))
        assertEquals(CardView.Ended(CARD_DUPLICATE), cardView(PollReply.Ok("DUPLICATE", null), 1_000))
    }

    @Test
    fun `waiting texts are plain`() {
        assertEquals("Waiting for Paystack to confirm…", CardView.Waiting(false, false).text)
        assertEquals("Not confirmed yet — still checking", CardView.Waiting(true, true).text)
    }

    @Test
    fun `a card payment is Paid only on SUCCESS with the ticket PAID - never on no connection, 5xx or anything else`() {
        for (r in listOf(
            PollReply.NoConnection, PollReply.ServerError, PollReply.NotFound,
            PollReply.Ok("SUCCESS", null), PollReply.Ok("SUCCESS", ticket("UNPAID")), PollReply.Ok("success", ticket("PAID")),
            PollReply.Ok("", null), PollReply.Ok("PENDING", ticket("PAID")),
        )) {
            assertFalse(r.toString(), cardView(r, 120_000) is CardView.Paid)
        }
    }

    @Test
    fun `no connection or a 5xx while polling keeps waiting and says so`() {
        assertEquals(CardView.Problem(POLL_NO_CONNECTION, keepPolling = true), cardView(PollReply.NoConnection, 1_000))
        assertEquals(CardView.Problem(POLL_SERVER_ERROR, keepPolling = true), cardView(PollReply.ServerError, 1_000))
        assertEquals(CardView.Problem(POLL_NOT_FOUND, keepPolling = false), cardView(PollReply.NotFound, 1_000))
    }

    @Test
    fun `polling runs every 2 to 3 seconds and stops only on an end state`() {
        assertTrue(POLL_EVERY_MS in 2_000..3_000)
        assertTrue(keepsPolling(CardView.Waiting(false, false)))
        assertTrue(keepsPolling(CardView.Problem(POLL_NO_CONNECTION, true)))
        assertFalse(keepsPolling(CardView.Paid(ticket("PAID"))))
        assertFalse(keepsPolling(CardView.Ended(CARD_FAILED)))
    }

    // ------------------------------------------------ card: cancel

    @Test
    fun `Cancel payment is offered only after 60 seconds of waiting`() {
        assertFalse(cardView(PollReply.Ok("PENDING", null), 59_999).let { (it as CardView.Waiting).cancelOffered })
        assertTrue(cardView(PollReply.Ok("PENDING", null), 60_000).let { (it as CardView.Waiting).cancelOffered })
        assertEquals(60_000L, CANCEL_AFTER_MS)
    }

    @Test
    fun `the cancel answers, in plain words`() {
        assertEquals(CancelView.Ended(CARD_CANCELLED), cancelView(CancelReply.Ok("CANCELLED", forced = false, paymentStatus = "ABANDONED", ticket = null)))
        assertEquals(CancelView.Ended(CARD_CANCELLED_FORCED), cancelView(CancelReply.Ok("CANCELLED", forced = true, paymentStatus = "ABANDONED", ticket = null)))
        assertEquals(CancelView.Paid(ticket("PAID", "CARD")), cancelView(CancelReply.Ok("ALREADY_PAID", false, "SUCCESS", ticket("PAID", "CARD"))))
        assertEquals(CancelView.Ended(CARD_FAILED), cancelView(CancelReply.Ok("FAILED", false, "FAILED", null)))
        assertEquals(CancelView.Ended(CARD_ABANDONED), cancelView(CancelReply.Ok("ALREADY_ENDED", false, "ABANDONED", null)))
        assertEquals(CancelView.ConfirmForce(CANNOT_CONFIRM_WARNING), cancelView(CancelReply.CannotConfirm))
        assertTrue(CANNOT_CONFIRM_WARNING.contains("cannot be confirmed"))
    }

    @Test
    fun `too early - the backend's allowedAt is shown, in Lagos time, and the payment keeps waiting`() {
        assertEquals(CancelView.StillWaiting("Cancel is allowed from 14:06:05."), cancelView(CancelReply.TooEarly("2026-11-07T13:06:05.000Z")))
        assertEquals(CancelView.StillWaiting("Cancel is not allowed yet."), cancelView(CancelReply.TooEarly(null)))
    }

    @Test
    fun `a cancel with no connection or a 5xx cancels nothing and is never Paid`() {
        assertEquals(CancelView.StillWaiting(CANCEL_NO_CONNECTION), cancelView(CancelReply.NoConnection))
        assertEquals(CancelView.StillWaiting(CANCEL_SERVER_ERROR), cancelView(CancelReply.ServerError))
        assertTrue(CANCEL_NO_CONNECTION.contains("not cancelled"))
        // ALREADY_PAID without a PAID ticket in the answer: re-check, never Paid on its own.
        assertFalse(cancelView(CancelReply.Ok("ALREADY_PAID", false, "SUCCESS", null)) is CancelView.Paid)
    }

    // ------------------------------------------------ the checkout URL

    @Test
    fun `the checkout opens only for https on a Paystack host`() {
        for (ok in listOf("https://checkout.paystack.com/abc123", "https://checkout.paystack.com:443/x", "https://paystack.com/pay/x")) {
            assertTrue(ok, isPaystackCheckout(ok))
        }
        for (bad in listOf(
            "http://checkout.paystack.com/abc", "https://checkout.paystack.com.evil.example/abc",
            "https://evil.example/checkout.paystack.com", "https://checkout.paystack.com@evil.example/",
            "https://user@checkout.paystack.com/", "https://checkout.paystack.com:8443/x", "javascript:alert(1)",
            "intent://checkout.paystack.com#Intent;end", "https://paystackcom.example/", "", "not a url",
            "https://checkout.paystack.test/QRP_1", "HTTPS://CHECKOUT.PAYSTACK.COM/x",
        )) {
            assertFalse(bad, isPaystackCheckout(bad))
        }
        assertNull(checkoutToOpen(null))
        assertNull(checkoutToOpen("http://checkout.paystack.com/a"))
        assertEquals("https://checkout.paystack.com/a", checkoutToOpen("https://checkout.paystack.com/a"))
    }
}
