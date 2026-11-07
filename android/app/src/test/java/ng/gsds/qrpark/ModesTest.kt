package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** Modes.kt: the account's job, from the login response, decides the one screen. */
class ModesTest {

    @Test
    fun `an entry operator at an entry gate is in entry mode`() {
        assertEquals(Mode.ENTRY, modeFor("ENTRY_OPERATOR", "ENTRY"))
    }

    @Test
    fun `booth and exit operators get their holding screens, never entry`() {
        assertEquals(Mode.BOOTH_LATER, modeFor("PAYMENT_OPERATOR", "BOOTH"))
        assertEquals(Mode.EXIT_LATER, modeFor("EXIT_OPERATOR", "EXIT"))
        // Their location does not turn them into entry operators.
        assertEquals(Mode.BOOTH_LATER, modeFor("PAYMENT_OPERATOR", "ENTRY"))
        assertEquals(Mode.EXIT_LATER, modeFor("EXIT_OPERATOR", "ENTRY"))
    }

    @Test
    fun `an admin is sent to the Admin Portal`() {
        assertEquals(Mode.ADMIN, modeFor("ADMIN", null))
    }

    @Test
    fun `an entry operator without an entry gate gets no entry screen`() {
        assertEquals(Mode.NONE, modeFor("ENTRY_OPERATOR", null))
        assertEquals(Mode.NONE, modeFor("ENTRY_OPERATOR", "EXIT"))
        assertEquals(Mode.NONE, modeFor("ENTRY_OPERATOR", "BOOTH"))
    }

    @Test
    fun `an unknown, blank or differently spelt role is never entry`() {
        for (role in listOf(null, "", "entry_operator", "ENTRY", "OPERATOR", " ENTRY_OPERATOR", "SUPERVISOR")) {
            assertNotEquals("role '$role'", Mode.ENTRY, modeFor(role, "ENTRY"))
            assertEquals("role '$role'", Mode.NONE, modeFor(role, "ENTRY"))
        }
    }

    @Test
    fun `only entry mode opens the entry screens`() {
        assertEquals(listOf(Mode.ENTRY), Mode.values().filter { it.opensEntry })
    }

    @Test
    fun `each holding screen says what it is`() {
        assertEquals("Booth mode: coming in 4b", holdingText(Mode.BOOTH_LATER))
        assertEquals("Exit mode: coming in 4c", holdingText(Mode.EXIT_LATER))
        assertEquals("Admin accounts use the Admin Portal", holdingText(Mode.ADMIN))
        assertEquals("This account has no job on this app. Ask the admin.", holdingText(Mode.NONE))
    }
}
