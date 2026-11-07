package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Naira.kt: the backend's integer kobo, shown as naira by string work only.
 * The app never divides, multiplies or rounds an amount.
 */
class NairaTest {

    @Test
    fun `kobo is shown as naira with two decimals and grouped thousands`() {
        assertEquals("₦500.00", naira(50_000))
        assertEquals("₦0.05", naira(5))
        assertEquals("₦0.50", naira(50))
        assertEquals("₦0.00", naira(0))
        assertEquals("₦1.00", naira(100))
        assertEquals("₦1,000.00", naira(100_000))
        assertEquals("₦12,345.67", naira(1_234_567))
        assertEquals("₦1,234,567.89", naira(123_456_789))
        assertEquals("₦92,233,720,368,547,758.07", naira(Long.MAX_VALUE))
    }

    @Test
    fun `a negative amount is never shown as money`() {
        // The backend never sends one; if it did, the screen must not dress it up.
        assertEquals("₦?", naira(-1))
    }

    /**
     * The no-arithmetic rule, on the source itself: Naira.kt has no division,
     * remainder or multiplication, and no floating point. Every other main
     * source file has no arithmetic on a kobo value either.
     */
    @Test
    fun `naira formatting and every kobo value use no arithmetic and no floating point`() {
        val naira = File("src/main/java/ng/gsds/qrpark/Naira.kt").readText()
        val code = stripComments(naira)
        for (bad in listOf(Regex("""[^/*]/[^/*]"""), Regex("""%"""), Regex("""\*"""), Regex("""\bDouble\b|\bFloat\b|toDouble|toFloat|BigDecimal"""))) {
            assertTrue("Naira.kt has `${bad.pattern}`", bad.find(code.replace("\"", "")) == null)
        }
        // `->` (a lambda or a when branch) is not arithmetic.
        val kobo = Regex("""(?i)kobo\w*\s*([+*/%]|-(?!>))|([+*/%]|(?<!-)-)\s*\w*kobo""")
        val offenders = mainSources().filter { kobo.containsMatchIn(stripComments(it.readText())) }
        assertTrue("arithmetic on kobo in: ${offenders.map { it.name }}", offenders.isEmpty())
    }
}

/** Main source files, for the tests that check what the code says. */
fun mainSources(): List<File> =
    File("src/main/java").walkTopDown().filter { it.isFile && it.extension in setOf("kt", "java") }.toList()

/** The code without its comments and string templates' text, roughly: enough for a scan. */
fun stripComments(source: String): String =
    source.replace(Regex("""/\*[\s\S]*?\*/"""), "").replace(Regex("""//[^\n]*"""), "")
