package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The checkout WebView's rules, checked on the source (Sprint 4b fix), like
 * SourceRulesTest. The checkout runs Paystack's page inside the app; these
 * keep that page boxed in: no bridge into the app, no files, no debugging, no
 * clicking past a bad certificate, https only, nothing left behind.
 */
class WebViewRulesTest {

    private val sources = mainSources().associate { it.name to stripComments(it.readText()) }
    private val sheet = sources.getValue("CheckoutSheet.kt")
    private fun anywhere(pattern: Regex) = sources.filter { (_, src) -> pattern.containsMatchIn(src) }.keys

    @Test
    fun `no JavaScript bridge into the app`() {
        assertEquals(emptySet<String>(), anywhere(Regex("""addJavascriptInterface""")))
    }

    @Test
    fun `an SSL error is never proceeded past - always cancelled`() {
        assertEquals(emptySet<String>(), anywhere(Regex("""\.proceed\s*\(""")))
        val handler = Regex("""onReceivedSslError[\s\S]*?\{([\s\S]*?)\n            \}""").find(sheet)?.groupValues?.get(1).orEmpty()
        assertTrue(handler, handler.contains("handler.cancel()"))
    }

    @Test
    fun `file and content access are off, and never switched on`() {
        assertEquals(emptySet<String>(), anywhere(Regex("""allow(File|Content|UniversalAccess|FileAccessFrom)\w*\s*=\s*true|setAllow\w*Access\w*\(\s*true""")))
        assertTrue(sheet.contains("allowFileAccess = false"))
        assertTrue(sheet.contains("allowContentAccess = false"))
    }

    @Test
    fun `web contents debugging is off, and never switched on`() {
        assertEquals(emptySet<String>(), anywhere(Regex("""setWebContentsDebuggingEnabled\s*\(\s*true""")))
        assertTrue(sheet.contains("WebView.setWebContentsDebuggingEnabled(false)"))
    }

    @Test
    fun `mixed content never, no form saving`() {
        assertTrue(sheet.contains("mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW"))
        assertEquals(emptySet<String>(), anywhere(Regex("""MIXED_CONTENT_(ALWAYS_ALLOW|COMPATIBILITY_MODE)""")))
        assertTrue(sheet.contains("saveFormData = false"))
        assertEquals(emptySet<String>(), anywhere(Regex("""saveFormData\s*=\s*true|savePassword\s*=\s*true""")))
    }

    @Test
    fun `navigation allows https only`() {
        val nav = sources.getValue("CheckoutNavigation.kt")
        assertFalse("plain http is allowed somewhere", Regex(""""http"""").containsMatchIn(nav))
        assertEquals(Navigation.BLOCK, decideNavigation("http", "checkout.paystack.com", true))
        assertEquals(Navigation.LOAD, decideNavigation("https", "checkout.paystack.com", true))
    }

    @Test
    fun `the first address must be Paystack's https checkout before anything loads`() {
        val check = sheet.indexOf("val safe = checkoutToOpen(url)")
        val load = sheet.indexOf("web.loadUrl(safe)")
        assertTrue("checked", check > 0)
        assertTrue("loaded only after the check, and only the checked value", load > check)
        assertEquals("the raw address is never loaded", 0, Regex("""loadUrl\(url\)""").findAll(sheet).count())
    }

    @Test
    fun `on close the cache, cookies, web storage and form data are cleared`() {
        val onClose = sheet.substringAfter("setOnDismissListener").substringBefore("dialog.show()")
        for (call in listOf("clearCache(true)", "clearFormData()", "CookieManager.getInstance().removeAllCookies(", "WebStorage.getInstance().deleteAllData()")) {
            assertTrue(call, onClose.contains(call))
        }
    }

    @Test
    fun `WebView is used only in CheckoutSheet, and the browser hand-off is gone`() {
        assertEquals(setOf("CheckoutSheet.kt"), anywhere(Regex("""\bWebView\b""")))
        assertEquals(emptySet<String>(), anywhere(Regex("""ACTION_VIEW""")))
    }

    @Test
    fun `the failure view never shows the address`() {
        // Only sanitised reasons go into it: a net::ERR_ code, an HTTP status, a TLS code.
        val reasons = Regex("""failureReason\.text\s*=\s*([^\n]+)""").findAll(sheet).map { it.groupValues[1] }.toList()
        assertTrue(reasons.isNotEmpty())
        val allowed = listOf(
            "pageFailureReason(error.description?.toString())",
            "\"HTTP \${errorResponse.statusCode}\"",
            "\"TLS \${error.primaryError}\"",
        )
        for (r in reasons) {
            assertTrue("an unsanitised failure reason: $r", r.trim() == "\"\"" || allowed.any { r.contains(it) })
            assertFalse(r, Regex("""\burl\b""", RegexOption.IGNORE_CASE).containsMatchIn(r))
        }
    }
}
