package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Modes.kt: the account's job, from the login response, decides the one screen. */
class ModesTest {

    @Test
    fun `an entry operator at an entry gate is in entry mode`() {
        assertEquals(Mode.ENTRY, modeFor("ENTRY_OPERATOR", "ENTRY"))
    }

    @Test
    fun `a payment operator at a booth is in booth mode, an exit operator at an exit gate in exit mode`() {
        assertEquals(Mode.BOOTH, modeFor("PAYMENT_OPERATOR", "BOOTH"))
        assertEquals(Mode.EXIT, modeFor("EXIT_OPERATOR", "EXIT"))
    }

    @Test
    fun `an exit operator without an exit gate gets no exit screen`() {
        assertEquals(Mode.NONE, modeFor("EXIT_OPERATOR", null))
        assertEquals(Mode.NONE, modeFor("EXIT_OPERATOR", "ENTRY"))
        assertEquals(Mode.NONE, modeFor("EXIT_OPERATOR", "BOOTH"))
    }

    @Test
    fun `each job opens exactly one screen, and none opens another's`() {
        assertEquals(listOf(Mode.EXIT), Mode.values().filter { it.opensExit })
        for (m in Mode.values()) {
            assertTrue(m.name, listOf(m.opensEntry, m.opensBooth, m.opensExit).count { it } <= 1)
        }
        assertFalse(Mode.BOOTH.opensExit)
        assertFalse(Mode.EXIT.opensBooth)
    }

    @Test
    fun `a payment operator without a booth gets no booth screen`() {
        assertEquals(Mode.NONE, modeFor("PAYMENT_OPERATOR", null))
        assertEquals(Mode.NONE, modeFor("PAYMENT_OPERATOR", "ENTRY"))
        assertEquals(Mode.NONE, modeFor("PAYMENT_OPERATOR", "EXIT"))
    }

    @Test
    fun `only booth mode opens the booth, and booth never opens entry`() {
        assertEquals(listOf(Mode.BOOTH), Mode.values().filter { it.opensBooth })
        assertFalse(Mode.BOOTH.opensEntry)
        assertFalse(Mode.ENTRY.opensBooth)
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
        assertEquals("Admin accounts use the Admin Portal", holdingText(Mode.ADMIN))
        assertEquals("This account has no job on this app. Ask the admin.", holdingText(Mode.NONE))
    }
}
