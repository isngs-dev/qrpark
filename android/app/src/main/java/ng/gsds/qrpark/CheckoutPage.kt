package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/pos/app/src/main/java/ng/eparking/pos/CheckoutPage.kt; package changed; pageFailureReason() added (the failure view never shows the URL).

/**
 * What the checkout sheet's own page is doing.
 *
 * The sheet tracked nothing: it created a WebView, called loadUrl, and showed
 * whatever happened. So the operator could not tell a page that was loading
 * from one that had failed - a blank rectangle under the amber bar for the
 * first, and Chrome's stock "Webpage not available" with the full checkout URL
 * printed on it for the second.
 *
 * THE STATES ARE THE PAGE'S, NEVER THE PAYMENT'S. The sheet is a viewport onto
 * a page Paystack serves and has no authority over the money - see
 * CheckoutNavigation. A page that will not load says nothing about whether the
 * customer was debited: an earlier attempt may have gone through, the poller
 * behind the sheet never stopped, and the backend decides. Nothing here closes
 * the sheet, calls the backend or reports an outcome, and there is deliberately
 * no state that could be mistaken for one.
 *
 * ONE SUBTLETY IS THE WHOLE REASON THIS IS A MODULE. onPageFinished fires after
 * an error as well, because the error page is itself a page and it finishes
 * loading. Mapping FINISHED to "shown" therefore wipes the error view a moment
 * after it appears, and nobody finds out until a real network drop.
 */

/** What the sheet's page is doing. */
enum class PageState {
    /** A navigation is in flight; nothing useful is on screen yet. */
    LOADING,

    /** The page rendered. */
    SHOWN,

    /** The page could not be loaded at all. */
    FAILED,
}

/** Something the WebView reported. */
enum class PageEvent {
    /** A main-frame navigation began. */
    STARTED,

    /** A main-frame navigation finished - including the error page's own load. */
    FINISHED,

    /** The main frame could not be loaded: DNS, connection, timeout, HTTP, TLS. */
    MAIN_FRAME_ERROR,

    /** Something inside the page failed - an image, a script, a beacon. */
    SUBFRAME_ERROR,
}

/** Where the sheet starts: nothing has arrived yet. */
val PAGE_OPENING = PageState.LOADING

/** What the sheet should be showing once [event] has happened. */
fun afterPageEvent(state: PageState, event: PageEvent): PageState = when (event) {
    // Every leg of a 3-D Secure trip is a fresh main-frame load with its own
    // blank gap - and a retry starts one too, which is what clears the error
    // view as the new attempt begins.
    PageEvent.STARTED -> PageState.LOADING

    PageEvent.MAIN_FRAME_ERROR -> PageState.FAILED

    // Not simply SHOWN: see the note above about the error page finishing.
    PageEvent.FINISHED -> if (state == PageState.FAILED) PageState.FAILED else PageState.SHOWN

    // A font, an image, a beacon. The checkout is on screen and usable, and
    // replacing it with an error view would be a lie the customer pays for.
    PageEvent.SUBFRAME_ERROR -> state
}

/**
 * What the failure view may say about why the page failed: a WebView error
 * code ("net::ERR_INTERNET_DISCONNECTED"), never free text. WebView's
 * descriptions are normally just the code, but nothing guarantees it, and the
 * view must never show the checkout address (Sprint 4b fix): anything that is
 * not exactly a net::ERR_ code is shown as "network error".
 */
fun pageFailureReason(description: String?): String {
    val d = description?.trim().orEmpty()
    return if (Regex("^net::ERR_[A-Z0-9_]{1,60}$").matches(d)) d else "network error"
}
