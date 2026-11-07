package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/pos/app/src/test/java/ng/eparking/pos/CheckoutPageTest.kt; package changed; a test for pageFailureReason() added.

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * What the checkout sheet says while its page loads, and when it cannot.
 *
 * The sheet tracked nothing. Two things an operator saw, both reproduced:
 *
 *  1. THE GAP. Frames captured while opening, sampling the sheet's bar and the
 *     page area:
 *
 *       1-3   body (23,27,36)     the visit screen, "Starting payment..."
 *       4-5   body (244,246,249)  sheet opening, WebView empty
 *       6-12  bar (255,246,229), body (255,255,255)  sheet open, page blank
 *
 *     There IS a spinner in the sheet eventually - but it is PAYSTACK'S, drawn
 *     by their HTML, so it appears only once their page has already arrived.
 *     Before that the operator has an amber bar over an empty rectangle and no
 *     way to tell whether anything is happening.
 *
 *  2. THE FAILURE. With DNS broken but the backend still reachable by IP - so
 *     the charge started normally and only the checkout page could not resolve
 *     - the sheet showed Chrome's stock error page:
 *
 *       Webpage not available
 *       The webpage at https://checkout.paystack.com/e37y7eqpth5qj3g could not
 *       be loaded because:
 *       net::ERR_NAME_NOT_RESOLVED
 *
 *     A green Android robot and the full checkout URL, in front of a customer,
 *     with no way to retry.
 *
 * Worth recording, because the first attempt at (2) proved something else: a
 * network drop AFTER Paystack's shell has loaded is handled by Paystack, whose
 * own page says "We could not start this transaction - Network Error" and
 * offers Reload. Only a MAIN FRAME failure leaves nothing to report it, which
 * is the case this file is about.
 *
 * THE TRAP THIS FILE EXISTS FOR: onPageFinished fires after an error too,
 * because the error page itself finishes loading. An implementation that maps
 * FINISHED to "shown" wipes its own error view a moment after showing it, and
 * nobody sees that until their network drops.
 *
 * WHAT IS DELIBERATELY ABSENT. None of this touches the payment. The sheet has
 * no authority over one - it is a viewport onto a page Paystack serves - so a
 * page that fails to load says the PAGE failed and nothing about the money. The
 * customer may already have been debited on an earlier attempt, the poller
 * behind the sheet is still running, and the backend decides. There is no state
 * here for "payment failed" and no event that takes the sheet down.
 */
class CheckoutPageTest {

    // ------------------------------------------------------------ the gap

    @Test
    fun `the sheet opens in a loading state`() {
        // THE gap. Between the dialog appearing and Paystack's HTML painting,
        // something of ours has to be on screen.
        assertEquals(PageState.LOADING, PAGE_OPENING)
    }

    @Test
    fun `a navigation shows loading again`() {
        // 3-D Secure sends the page to the card issuer and back. Each leg is a
        // fresh main-frame load, and each one has its own blank gap.
        assertEquals(PageState.LOADING, afterPageEvent(PageState.SHOWN, PageEvent.STARTED))
    }

    @Test
    fun `a finished page is shown`() {
        assertEquals(PageState.SHOWN, afterPageEvent(PageState.LOADING, PageEvent.FINISHED))
    }

    // --------------------------------------------------------- the failure

    @Test
    fun `a main frame error fails the page`() {
        assertEquals(PageState.FAILED, afterPageEvent(PageState.LOADING, PageEvent.MAIN_FRAME_ERROR))
    }

    @Test
    fun `finishing does not clear a failure`() {
        // THE trap. Chrome's error page is itself a page, and it finishes
        // loading - so FINISHED arrives right after the error and would wipe
        // the error view a moment after it appeared.
        assertEquals(PageState.FAILED, afterPageEvent(PageState.FAILED, PageEvent.FINISHED))
    }

    @Test
    fun `a second error leaves it failed`() {
        assertEquals(
            PageState.FAILED,
            afterPageEvent(PageState.FAILED, PageEvent.MAIN_FRAME_ERROR),
        )
    }

    @Test
    fun `trying again clears the failure`() {
        // Try again reloads, which starts a navigation. The error view must go
        // as the attempt begins, or the operator cannot tell the retry from
        // the failure it replaced.
        assertEquals(PageState.LOADING, afterPageEvent(PageState.FAILED, PageEvent.STARTED))
    }

    // ------------------------------------------- what is not a broken page

    @Test
    fun `something failing inside the page is not a failed page`() {
        // A font, an image, an analytics beacon. The checkout is on screen and
        // usable; replacing it with an error view would be a lie the customer
        // pays for.
        assertEquals(PageState.SHOWN, afterPageEvent(PageState.SHOWN, PageEvent.SUBFRAME_ERROR))
        assertEquals(PageState.LOADING, afterPageEvent(PageState.LOADING, PageEvent.SUBFRAME_ERROR))
        assertEquals(PageState.FAILED, afterPageEvent(PageState.FAILED, PageEvent.SUBFRAME_ERROR))
    }

    // --------------------------------------------------- stated as a whole

    @Test
    fun `only a main frame error can fail the page`() {
        // So an event added later has to be considered rather than inheriting
        // the power to blank a live checkout.
        PageState.entries.forEach { state ->
            PageEvent.entries
                .filter { it != PageEvent.MAIN_FRAME_ERROR }
                .forEach { event ->
                    if (state != PageState.FAILED) {
                        assertNotEquals(
                            "$event must not fail a page that was $state",
                            PageState.FAILED,
                            afterPageEvent(state, event),
                        )
                    }
                }
        }
    }

    @Test
    fun `nothing here reports anything about the payment`() {
        // The states are the page's, not the money's. If this list ever grows a
        // PAID, FAILED_PAYMENT or similar, the sheet has started deciding
        // something it has no authority over - see CheckoutNavigation.
        assertEquals(
            listOf(PageState.LOADING, PageState.SHOWN, PageState.FAILED),
            PageState.entries.toList(),
        )
    }

    // ------------------------------------------------ qrpark: the failure reason

    @Test
    fun `the failure reason is a net error code or nothing - never an address`() {
        assertEquals("net::ERR_INTERNET_DISCONNECTED", pageFailureReason("net::ERR_INTERNET_DISCONNECTED"))
        assertEquals("net::ERR_NAME_NOT_RESOLVED", pageFailureReason(" net::ERR_NAME_NOT_RESOLVED "))
        for (bad in listOf(
            "https://checkout.paystack.com/abc123 could not be loaded",
            "net::ERR_FAILED https://checkout.paystack.com/abc123",
            "checkout.paystack.com/abc123", "", null, "net::err_lowercase",
        )) {
            assertEquals(bad.toString(), "network error", pageFailureReason(bad))
        }
    }
}
