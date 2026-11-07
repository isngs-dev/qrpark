package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TicketPaper.kt and TicketHeader.kt: what the entry ticket says, and its
 * header (GSD left, AIC right, the organisation name else the display name,
 * the contact line beneath; never "E-Parking").
 */
class TicketPaperTest {

    private val tenPerChar: (String) -> Float = { it.length * 10f }

    @Test
    fun `the ticket carries every required line, from the backend's values`() {
        val paper = ticketPaper(sampleTicket())
        assertEquals("T".repeat(43), paper.qrToken)
        val text = paper.lines.joinToString("\n")
        assertTrue(text, text.contains("Vehicle  Car"))
        assertTrue(text, text.contains("Fee      ₦500.00"))
        // 13:05 UTC is 14:05 in Lagos (UTC+1, no daylight saving).
        assertTrue(text, text.contains("Issued   07 Nov 2026 14:05"))
        assertTrue(text, text.contains("Valid today only"))
        assertTrue(text, text.contains("Ticket   K7MP-3QZ9"))
        assertTrue(text, text.contains("Entry    Test entry 1"))
        assertEquals(TICKET_FOOTER, "Pay at the payment booth. Show this ticket at the exit.")
        assertTrue(text, text.replace("\n", " ").contains(TICKET_FOOTER))
    }

    @Test
    fun `the ticket's text never carries the token, which is only the QR`() {
        val paper = ticketPaper(sampleTicket(token = "Q".repeat(43)))
        assertTrue(paper.lines.none { it.contains("QQQQ") })
    }

    @Test
    fun `Lagos time is the backend's UTC instant shown at UTC+1`() {
        assertEquals("07 Nov 2026 00:30", lagosTime("2026-11-06T23:30:00.000Z"))
        assertEquals("07 Nov 2026 14:05", lagosTime("2026-11-07T13:05:00Z"))
        assertEquals("?", lagosTime("not a time"))
    }

    // ------------------------------------------------ the header

    @Test
    fun `GSD stands on the left and AIC on the right`() {
        assertEquals(HeaderLogo.GSD, HEADER_LOGO_LEFT)
        assertEquals(HeaderLogo.AIC, HEADER_LOGO_RIGHT)
    }

    @Test
    fun `the brand line is the organisation name, else the display name, and the contact line follows`() {
        assertEquals(HeaderText("GSD Services Ltd", "Call 0800 000 0000"),
            HeaderText.of("Garki International Market", " GSD Services Ltd ", " Call 0800 000 0000 "))
        assertEquals(HeaderText("Garki International Market", null),
            HeaderText.of("Garki International Market", null, null))
        assertEquals(HeaderText("Garki International Market", null),
            HeaderText.of("Garki International Market", "  ", ""))
        assertEquals(HeaderText("", null), HeaderText.of(null, null, null))
        assertEquals(HeaderText("", null), HeaderText.of("null", "null", "null"))
    }

    @Test
    fun `the header never says E-Parking`() {
        for (h in listOf(HeaderText.of(null, null, null), HeaderText.of("Garki", null, null), HeaderText.of("A", "B", "C"))) {
            val plan = headerPlan(h, middle = 150f, full = 384f, measureBrand = tenPerChar, measureContact = tenPerChar)
            val all = (plan.brandLines + plan.contactLines).joinToString(" ")
            assertTrue(all, !all.contains("E-Parking", ignoreCase = true))
        }
        val code = mainSources().joinToString("\n") { stripComments(it.readText()) }
        assertTrue("no E-Parking in the app's code", !code.contains("E-Parking", ignoreCase = true))
        assertTrue("no E-Parking in the strings", !java.io.File("src/main/res/values/strings.xml").readText().contains("E-Parking", ignoreCase = true))
    }

    @Test
    fun `a short brand and contact stay between the logos`() {
        val plan = headerPlan(HeaderText("Garki", "0800"), 150f, 384f, tenPerChar, tenPerChar)
        assertEquals(HeaderLayout.INLINE, plan.layout)
        assertEquals(listOf("Garki"), plan.brandLines)
        assertEquals(listOf("0800"), plan.contactLines)
    }

    @Test
    fun `a long brand or contact moves beneath the logos, whole`() {
        val name = "Garki International Market"
        val plan = headerPlan(HeaderText(name, "Call 0800 000 0000 for help"), 150f, 384f, tenPerChar, tenPerChar)
        assertEquals(HeaderLayout.STACKED, plan.layout)
        assertEquals(name, plan.brandLines.joinToString(" "))
        assertEquals("Call 0800 000 0000 for help", plan.contactLines.joinToString(" "))
        val longContact = headerPlan(HeaderText("Garki", "x".repeat(20)), 150f, 384f, tenPerChar, tenPerChar)
        assertEquals(HeaderLayout.STACKED, longContact.layout)
    }

    @Test
    fun `no brand and no contact leaves only the logos`() {
        val plan = headerPlan(HeaderText("", null), 150f, 384f, tenPerChar, tenPerChar)
        assertTrue(plan.brandLines.isEmpty() && plan.contactLines.isEmpty())
        assertEquals(HeaderLayout.INLINE, plan.layout)
    }

    @Test
    fun `a word wider than the line is broken, never cut`() {
        val lines = wrapWords("Abcdefghijklmnopqrstuvwxyz", 100f, tenPerChar)
        assertEquals("Abcdefghijklmnopqrstuvwxyz", lines.joinToString(""))
        assertTrue(lines.all { it.length <= 10 })
    }
}
