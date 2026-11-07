package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/pos/app/src/main/java/ng/eparking/pos/CheckoutNavigation.kt; package changed; https ONLY (eparking also allowed http).

/**
 * What the checkout sheet does when its page tries to navigate.
 *
 * Extracted from CheckoutSheet so the decision can be tested: the sheet itself
 * is WebView, Dialog and WebResourceRequest all the way down, and none of that
 * runs on a JVM.
 *
 * THE SHEET IS A VIEWPORT AND A VIEWPORT DOES NOT DECIDE. It closes on exactly
 * three things - the payment reaching a resting state, the operator tapping
 * Close, and the screen being destroyed - and none of them is a URL.
 *
 * It used to close itself whenever the page left a paystack.com host. That
 * reads as prudent and is the opposite: a genuine 3-D Secure step is served by
 * the CARD ISSUER's access control server, on a bank's own domain, so the
 * payment page vanished while the customer stood at their bank's OTP prompt.
 * The same callback fires for iframes, so an embedded 3DS step closed it too.
 * Sandbox never reproduced it, because sandbox card flow stays on Paystack
 * hosts - which is how it survived a live test pass.
 *
 * Recognising "done" by URL was considered and rejected for the same reason:
 * it works until a URL format changes, and a too-broad match quietly brings
 * the early close back.
 */

/** What to do with an attempted navigation. */
enum class Navigation {
    /** Let the page load it. */
    LOAD,

    /**
     * Refuse it, and do nothing else.
     *
     * Note what is NOT here: there is no outcome that takes the sheet down.
     * The wrong answer is unrepresentable rather than merely unused, so
     * bringing it back has to be a deliberate act that fails a test.
     */
    BLOCK,
}

/**
 * Decide one navigation.
 *
 * Only the scheme is consulted. [host] and [isMainFrame] are parameters
 * precisely so the tests can assert that neither influences the outcome -
 * removing them would make this whole class of bug inexpressible as a test,
 * and a future edit that started reading the host again would look reasonable
 * and break nothing.
 *
 * The asymmetry that settles it: closing too early interrupts a customer
 * mid-payment on a page they cannot get back to, and closing too late shows a
 * dead page for a few seconds while the poller - already running behind the
 * sheet - settles the payment and takes it down.
 */
fun decideNavigation(scheme: String?, host: String?, isMainFrame: Boolean): Navigation =
    // HTTPS only (Sprint 4b fix: eparking also let plain http load). A card
    // page, a bank's 3-D Secure step and Paystack itself are all https; plain
    // http on a payment page is refused, as is anything that is not web
    // traffic - a bank app deep link, an intent: URL - rather than handed to
    // whatever app claims the scheme.
    if (scheme == "https") Navigation.LOAD else Navigation.BLOCK
