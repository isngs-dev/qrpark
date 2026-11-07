package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/pos/app/src/main/java/ng/eparking/pos/CheckoutSheet.kt and adapted
// (Sprint 4b fix): the first address must pass checkoutToOpen() (https on a Paystack host) or a plain error is
// shown and nothing loads; navigation https only (CheckoutNavigation.kt); the WebView hardened (no file or
// content access, mixed content never, no form saving, debugging off, no JavaScript bridge); SSL errors
// cancelled; the failure view shows a sanitised code, never the address; on close the cache, cookies, web
// storage, form data and history are cleared. Strings and colours are this app's.

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.graphics.Bitmap
import android.net.http.SslError
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * The Paystack checkout, shown inside the app.
 *
 * **This sheet has no authority over a payment.** It is a viewport onto a page
 * Paystack serves, and nothing more. It does not read the page, does not
 * inspect the result, does not call the backend, and does not report success.
 * Closing - whether the customer finished, gave up, or the operator tapped
 * Close - means only that there is nothing more to show. The booth screen
 * underneath polls the backend the whole time and carries on afterwards
 * unchanged; "Paid" appears only on the backend's SUCCESS.
 *
 * It closes on exactly three things, and none of them is a URL: the payment
 * reaching a resting state (the booth dismisses it), the operator tapping
 * Close (or Back), and the screen being destroyed.
 *
 * No card data passes through our code. The page is Paystack's, served over
 * HTTPS into a WebView; we host the frame, not the form. The address is never
 * logged, stored or shown.
 */
object CheckoutSheet {

    /**
     * Opens the sheet on [url], which must pass [checkoutToOpen]; anything else
     * shows a plain error and loads nothing.
     *
     * @param onClosed run when the sheet goes away, for the caller to forget
     *   its reference. It is deliberately given no outcome to report.
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun open(activity: Activity, url: String, onClosed: () -> Unit = {}): Dialog {
        val dialog = Dialog(activity, android.R.style.Theme_Material_Light_NoActionBar)

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ContextCompat.getColor(activity, R.color.surface))
        }
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val bar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(8), dp(12), dp(8))
            setBackgroundColor(ContextCompat.getColor(activity, R.color.pending_wash))
        }
        bar.addView(
            TextView(activity).apply {
                text = activity.getString(R.string.checkout_sheet_title)
                textSize = 15f
                setTextColor(ContextCompat.getColor(activity, R.color.pending))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            },
        )

        val web = WebView(activity)

        // The operator's way out. Always present: closing costs nothing, the
        // payment is settled by the backend and the booth never stopped waiting.
        bar.addView(
            Button(activity).apply {
                text = activity.getString(R.string.checkout_sheet_close)
                setOnClickListener { dialog.dismiss() }
            },
        )

        val loading = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            addView(ProgressBar(activity))
            addView(
                TextView(activity).apply {
                    text = activity.getString(R.string.checkout_page_loading)
                    textSize = 15f
                    setPadding(dp(24), dp(16), dp(24), 0)
                    gravity = Gravity.CENTER
                    setTextColor(ContextCompat.getColor(activity, R.color.ink_soft))
                },
            )
        }

        // When the page cannot be loaded. It replaces WebView's stock error
        // page, which prints the full checkout address; this one never does.
        val failureTitle = TextView(activity).apply {
            text = activity.getString(R.string.checkout_page_failed)
            textSize = 18f
            setTextColor(ContextCompat.getColor(activity, R.color.ink))
        }
        val failureReason = TextView(activity).apply {
            textSize = 13f
            setTextColor(ContextCompat.getColor(activity, R.color.ink_soft))
            setPadding(0, dp(12), 0, 0)
        }
        val retry = Button(activity).apply {
            text = activity.getString(R.string.checkout_page_retry)
            setOnClickListener { web.reload() }
        }
        val error = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            visibility = View.GONE
            addView(failureTitle)
            addView(
                // The page failed; the payment is not this sheet's to judge.
                TextView(activity).apply {
                    text = activity.getString(R.string.checkout_page_failed_body)
                    textSize = 15f
                    setPadding(0, dp(12), 0, 0)
                    setTextColor(ContextCompat.getColor(activity, R.color.ink_soft))
                },
            )
            addView(failureReason)
            addView(
                retry,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    .apply { topMargin = dp(24) },
            )
        }

        val content = FrameLayout(activity).apply {
            addView(web)
            addView(loading)
            addView(error)
        }

        fun render(state: PageState) {
            web.visibility = if (state == PageState.SHOWN) View.VISIBLE else View.INVISIBLE
            loading.visibility = if (state == PageState.LOADING) View.VISIBLE else View.GONE
            error.visibility = if (state == PageState.FAILED) View.VISIBLE else View.GONE
        }

        var page = PAGE_OPENING
        fun onPageEvent(event: PageEvent) {
            page = afterPageEvent(page, event)
            render(page)
        }
        render(page)

        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.padForSystemBars()

        // No inspection of this page from a computer, in any build.
        WebView.setWebContentsDebuggingEnabled(false)
        web.settings.apply {
            // Paystack's checkout is a JavaScript application and will not
            // render without these two. Nothing else is enabled, and there is
            // no bridge from the page into this app.
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            @Suppress("DEPRECATION")
            saveFormData = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
        }

        web.webViewClient = object : WebViewClient() {
            /** Returns true to REFUSE a navigation. No branch takes the sheet down (CheckoutNavigation.kt). */
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                decideNavigation(request.url.scheme, request.url.host, request.isForMainFrame) == Navigation.BLOCK

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = onPageEvent(PageEvent.STARTED)

            override fun onPageFinished(view: WebView, url: String) = onPageEvent(PageEvent.FINISHED)

            /** Transport-level: DNS, refused connection, timeout, no network. */
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return onPageEvent(PageEvent.SUBFRAME_ERROR)
                failureReason.text = activity.getString(R.string.checkout_page_reason, pageFailureReason(error.description?.toString()))
                onPageEvent(PageEvent.MAIN_FRAME_ERROR)
            }

            /** A server that answered, badly. */
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (!request.isForMainFrame) return onPageEvent(PageEvent.SUBFRAME_ERROR)
                failureReason.text = activity.getString(R.string.checkout_page_reason, "HTTP ${errorResponse.statusCode}")
                onPageEvent(PageEvent.MAIN_FRAME_ERROR)
            }

            /**
             * A certificate that does not check out. CANCEL, NEVER PROCEED: this
             * is a card page, and a bad certificate is where a payment stops.
             */
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                failureReason.text = activity.getString(R.string.checkout_page_reason, "TLS ${error.primaryError}")
                onPageEvent(PageEvent.MAIN_FRAME_ERROR)
            }
        }

        dialog.setContentView(root)
        dialog.setOnDismissListener {
            // Stop the page, then leave nothing of it behind on the device.
            web.stopLoading()
            web.loadUrl("about:blank")
            web.clearCache(true)
            web.clearFormData()
            web.clearHistory()
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            WebStorage.getInstance().deleteAllData()
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
            onClosed()
        }
        dialog.show()

        val safe = checkoutToOpen(url)
        if (safe == null) {
            // Not Paystack's https checkout: nothing is loaded, and the address is not shown.
            failureTitle.text = activity.getString(R.string.checkout_not_paystack)
            failureReason.text = ""
            retry.visibility = View.GONE
            render(PageState.FAILED)
        } else {
            web.loadUrl(safe)
        }
        return dialog
    }
}
