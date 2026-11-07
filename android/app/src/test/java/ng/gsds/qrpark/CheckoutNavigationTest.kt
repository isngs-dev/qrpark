package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/pos/app/src/test/java/ng/eparking/pos/CheckoutNavigationTest.kt; package changed; the http case now expects BLOCK (https only).

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The checkout sheet is a viewport, and a viewport does not decide.
 *
 * The bug these describe: the sheet closes itself based on WHICH HOST the page
 * navigated to. A genuine 3-D Secure step is served by the card issuer's own
 * access control server - a bank's domain, never Paystack's - so the payment
 * page vanishes while the customer is standing at their bank's OTP prompt.
 * The callback also fires for IFRAMES, so an embedded 3DS step or any
 * third-party asset frame closes it too.
 *
 * Sandbox never reproduces this, because sandbox card flow stays on Paystack
 * hosts. That is how it survived a live test pass.
 *
 * The sheet closes on exactly three things, none of which is a URL: the
 * payment reaching a resting state, the operator tapping Close, and the screen
 * being destroyed.
 */
class CheckoutNavigationTest {

    // --------------------------------------------- the sheet never dismisses

    @Test
    fun `there is no outcome that closes the sheet`() {
        // Structural, like ExitRequest's two-case seal. Re-adding a dismissal
        // has to be a deliberate act that fails a test, not a plausible edit.
        assertEquals(
            listOf(Navigation.LOAD, Navigation.BLOCK),
            Navigation.entries.toList(),
        )
    }

    // ------------------------------------------------------- 3-D Secure

    @Test
    fun `a bank's 3DS page loads on the main frame`() {
        // The issuer's ACS. Not a Paystack host, and never will be.
        assertEquals(
            Navigation.LOAD,
            decideNavigation("https", "acs.gtbank.com", isMainFrame = true),
        )
    }

    @Test
    fun `a bank's 3DS page loads in an iframe`() {
        assertEquals(
            Navigation.LOAD,
            decideNavigation("https", "secure5.arcot.com", isMainFrame = false),
        )
    }

    @Test
    fun `a card scheme's verification page loads`() {
        assertEquals(
            Navigation.LOAD,
            decideNavigation("https", "verifiedbyvisa.com", isMainFrame = true),
        )
        assertEquals(
            Navigation.LOAD,
            decideNavigation("https", "3dsecure.mastercard.com", isMainFrame = false),
        )
    }

    @Test
    fun `an unrelated third-party frame loads rather than closing the payment`() {
        // Analytics, fonts, a CDN. Harmless, and not grounds for taking a
        // payment page away from somebody mid-card-entry.
        assertEquals(
            Navigation.LOAD,
            decideNavigation("https", "fonts.googleapis.com", isMainFrame = false),
        )
    }

    @Test
    fun `the host does not affect the outcome at all`() {
        // The whole class of bug, stated once: no host is special, in either
        // direction. Paystack's own hosts get no privilege and nobody else is
        // penalised.
        val hosts = listOf(
            "checkout.paystack.com",
            "paystack.co",
            "acs.gtbank.com",
            "unknown.example",
            null,
        )
        hosts.forEach { host ->
            assertEquals(host ?: "null", Navigation.LOAD, decideNavigation("https", host, true))
            assertEquals(host ?: "null", Navigation.LOAD, decideNavigation("https", host, false))
        }
    }

    // ------------------------------------------------- what stays blocked

    @Test
    fun `a bank app deep link is refused, not followed`() {
        // Handing an intent: URL to whatever app claims the scheme puts the
        // customer outside this app, which is the thing the embedded sheet
        // exists to prevent. This guard is correct and stays.
        assertEquals(
            Navigation.BLOCK,
            decideNavigation("intent", "com.bank.app", isMainFrame = true),
        )
        assertEquals(Navigation.BLOCK, decideNavigation("market", "details", true))
        assertEquals(Navigation.BLOCK, decideNavigation("tel", null, true))
        assertEquals(Navigation.BLOCK, decideNavigation("about", "blank", false))
        assertEquals(Navigation.BLOCK, decideNavigation(null, "whatever", true))
    }

    @Test
    fun `ordinary checkout traffic loads`() {
        assertEquals(
            Navigation.LOAD,
            decideNavigation("https", "checkout.paystack.com", isMainFrame = true),
        )
    }

    @Test
    fun `plain http is refused, on any host and any frame (qrpark - https only)`() {
        for (host in listOf("checkout.paystack.com", "acs.gtbank.com", null)) {
            assertEquals(Navigation.BLOCK, decideNavigation("http", host, isMainFrame = true))
            assertEquals(Navigation.BLOCK, decideNavigation("http", host, isMainFrame = false))
        }
        assertEquals(Navigation.BLOCK, decideNavigation("HTTP", "checkout.paystack.com", true))
    }
}
