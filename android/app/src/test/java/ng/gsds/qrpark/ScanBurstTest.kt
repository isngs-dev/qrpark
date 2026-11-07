package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/dispenser/app/src/test/java/ng/eparking/dispenser/ScanBurstTest.kt; package changed, the log-line test removed with the log helpers.

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A keyboard-style scanner's burst, caught at the screen (ScanBurst.kt): fake
 * key events, a fake clock. The timing is the unit's: about 100-200 ms a
 * character, a 48-character lowercase hex ticket, then Enter.
 *
 * No token here is real - each is a made-up value of the same shape.
 */
class ScanBurstTest {

    private val ticket = "3f9a0c7e5b21d84f6a0e9c3b7d15f28a4c6e0b9d7f3a1c58"
    private val card = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718"

    /** A screen's field, counting what is submitted (Check ticket, Admit). */
    private class Field(override var text: String = "") : ScanTarget {
        var submitted = 0
        override fun submit() {
            submitted++
        }
    }

    private class Plate(override var text: String = "") : TypingField

    /**
     * A gate screen as Android runs it: each key goes to the Activity first
     * (the burst), and - unless consumed there - on to the focused view. A
     * focused field types characters itself and holds Enter/Tab
     * (credentialFieldKey, as holdScannerKeys does); a focused button is
     * pressed by Enter, as Android presses one on its UP.
     */
    private class Screen(var focus: String = "field", var fieldOnScreen: Boolean = true) {
        val field = Field()
        val plate = Plate()
        val pressed = mutableListOf<String>()
        var now = 1_000L
        val reports = mutableListOf<BurstReport>()

        val burst = ScanBurst(object : ScanScreen {
            override fun scanField(): ScanTarget? = field.takeIf { fieldOnScreen }
            override fun focusedTypingField(): TypingField? = plate.takeIf { focus == "plate" }
        }) { reports += it }

        fun key(keyCode: Int, char: Int, hardware: Boolean = true) {
            for (down in listOf(true, false)) {
                val k = ScanKey(now, down, keyCode, char, hardware)
                if (burst.key(k)) continue
                toFocused(k)
            }
        }

        private fun toFocused(k: ScanKey) {
            when (focus) {
                "field", "plate" -> {
                    val target: (String) -> Unit = if (focus == "field") ({ field.text = it }) else ({ plate.text = it })
                    val current = if (focus == "field") field.text else plate.text
                    if (k.down && credentialFieldKey(k.keyCode) == FieldKey.TYPE && k.char != 0) target(current + k.char.toChar())
                }
                // Enter on a focused button presses it.
                else -> if (!k.down && (k.keyCode == KEYCODE_ENTER || k.keyCode == KEYCODE_NUMPAD_ENTER)) pressed += focus
            }
        }

        /** [code] typed one key every [gapMs], then [end] (null: none). */
        fun scan(code: String, gapMs: Long = 150, end: Int? = KEYCODE_ENTER, hardware: Boolean = true) {
            code.forEachIndexed { i, c ->
                if (i > 0) now += gapMs
                key(KEYCODE_CHAR, c.code, hardware)
            }
            if (end != null) {
                now += gapMs
                key(end, 0, hardware)
            }
        }

        /** Time passes with no key; the idle timer fires. */
        fun pause(ms: Long) {
            now += ms
            burst.idle(now)
        }
    }

    // ------------------------------------------------------------ a scan fills

    @Test
    fun `a slow 48-character scan with 150 ms gaps then Enter fills the field, focused elsewhere`() {
        val s = Screen(focus = "nothing")
        s.scan(ticket)
        assertEquals(ticket, s.field.text)
        assertEquals(BurstOutcome.FILLED, s.reports.single().outcome)
        assertEquals(48, s.reports.single().chars)
        assertEquals(47 * 150L, s.reports.single().tookMs)
    }

    @Test
    fun `the same scan without Enter fills the field when a 600 ms gap ends it`() {
        val s = Screen(focus = "nothing")
        s.scan(ticket, end = null)
        s.pause(599)
        assertEquals("", s.field.text)
        s.pause(1)
        assertEquals(ticket, s.field.text)
        assertEquals(BurstEnd.IDLE, s.reports.single().end)
    }

    @Test
    fun `a gap under 600 ms continues the burst, 600 ms or more ends it`() {
        val s = Screen(focus = "nothing")
        s.scan(ticket, gapMs = 599)
        assertEquals(ticket, s.field.text)

        // Split by a 600 ms gap: two bursts of 24, each a scan, the second replacing the first.
        val t = Screen(focus = "nothing")
        t.scan(ticket.take(24), end = null)
        t.now += 600
        t.scan(ticket.drop(24))
        assertEquals(listOf(BurstEnd.IDLE, BurstEnd.ENTER), t.reports.map { it.end })
        assertEquals(ticket.drop(24), t.field.text)
    }

    @Test
    fun `a focused field typing the keys itself and the burst still end with the code once, not twice`() {
        val s = Screen(focus = "field")
        s.field.text = "last car's"
        s.scan(ticket)
        assertEquals(ticket, s.field.text)
        s.scan(ticket, end = null)
        s.pause(600)
        assertEquals(ticket, s.field.text)
    }

    @Test
    fun `two scans in a row each replace the field`() {
        for (focus in listOf("field", "nothing")) {
            val s = Screen(focus)
            s.scan(ticket)
            s.now += 2_000
            s.scan(card)
            assertEquals(focus, card, s.field.text)
            s.now += 2_000
            s.scan(ticket, end = KEYCODE_TAB)
            assertEquals(focus, ticket, s.field.text)
        }
    }

    // ------------------------------------------------------ what is not a scan

    @Test
    fun `a 7-character burst is ignored`() {
        val s = Screen(focus = "nothing")
        s.field.text = "kept"
        s.scan("3f9a0c7")
        s.scan("3f9a0c7", end = null)
        s.pause(600)
        assertEquals("kept", s.field.text)
        assertEquals(listOf(BurstOutcome.TOO_SHORT, BurstOutcome.TOO_SHORT), s.reports.map { it.outcome })
        // Eight is a scan.
        s.scan("3f9a0c7e")
        assertEquals("3f9a0c7e", s.field.text)
    }

    @Test
    fun `keys from a virtual device - the on-screen keyboard, injected keys - are ignored`() {
        val s = Screen(focus = "nothing")
        s.scan(ticket, hardware = false)
        s.pause(600)
        assertEquals("", s.field.text)
        assertTrue(s.reports.isEmpty())
        // And their Enter is never consumed: it reaches the focused view as ever.
        assertFalse(s.burst.key(ScanKey(s.now, true, KEYCODE_ENTER, 0, hardware = false)))
    }

    @Test
    fun `keys with no character - Shift, power, volume - are not counted and end nothing`() {
        val s = Screen(focus = "nothing")
        ticket.forEachIndexed { i, c ->
            if (i > 0) s.now += 150
            s.key(KEYCODE_SHIFT_LEFT, 0)
            s.key(KEYCODE_CHAR, c.code)
        }
        s.key(KEYCODE_VOLUME_UP, 0)
        s.now += 150
        s.key(KEYCODE_ENTER, 0)
        assertEquals(ticket, s.field.text)
    }

    @Test
    fun `a scan while no scan field is on screen is dropped, silently`() {
        val s = Screen(focus = "nothing", fieldOnScreen = false)
        s.scan(ticket)
        assertEquals(BurstOutcome.DROPPED, s.reports.single().outcome)
        assertEquals("", s.field.text)
        assertTrue(s.pressed.isEmpty())
    }

    // -------------------------------------------- a scan never admits or opens

    @Test
    fun `Enter and Tab that end a scan never press a focused button - Check ticket, Present at barrier, Admit`() {
        for (button in listOf("Check ticket", "Present at barrier", "Admit on pass card", "Admit")) {
            for (end in listOf(KEYCODE_ENTER, KEYCODE_NUMPAD_ENTER, KEYCODE_TAB)) {
                val s = Screen(focus = button)
                s.scan(ticket, end = end)
                s.now += 2_000
                s.scan(card, end = end)
                assertTrue("$button / $end: ${s.pressed}", s.pressed.isEmpty())
                assertEquals(card, s.field.text)
                assertEquals(0, s.field.submitted)
            }
        }
    }

    @Test
    fun `a scan never submits, whichever path filled the field`() {
        for (focus in listOf("field", "nothing", "plate")) {
            val s = Screen(focus)
            s.scan(ticket)
            s.scan(card, end = KEYCODE_TAB)
            assertEquals(focus, 0, s.field.submitted)
        }
    }

    // ------------------------------------------------------- the plate field

    @Test
    fun `a scan that lands in the plate field is taken out of it and put in the pass-card field`() {
        val s = Screen(focus = "plate")
        s.plate.text = "ABC123XY"
        s.scan(card)
        assertEquals("ABC123XY", s.plate.text)
        assertEquals(card, s.field.text)
        assertEquals(BurstOutcome.MOVED_OUT_OF_TYPING_FIELD, s.reports.single().outcome)
    }

    @Test
    fun `characters typed into the plate field are never moved to the pass-card field`() {
        // Short typing, with or without Enter.
        val s = Screen(focus = "plate")
        s.scan("KJA123", gapMs = 300)
        s.now += 2_000
        s.scan("XY", end = null)
        s.pause(600)
        assertEquals("KJA123XY", s.plate.text)
        assertEquals("", s.field.text)

        // Long typing with no Enter: plain typing, left as it is.
        val t = Screen(focus = "plate")
        t.scan("LAGOS-ABC-123-XY", gapMs = 250, end = null)
        t.pause(600)
        assertEquals("LAGOS-ABC-123-XY", t.plate.text)
        assertEquals("", t.field.text)
        assertEquals(BurstOutcome.LEFT_AS_TYPED, t.reports.single().outcome)
    }

    @Test
    fun `a plate scan with no scan field on screen still leaves the plate as it was`() {
        val s = Screen(focus = "plate", fieldOnScreen = false)
        s.plate.text = "ABC123XY"
        s.scan(card)
        assertEquals("ABC123XY", s.plate.text)
        assertEquals(BurstOutcome.DROPPED, s.reports.single().outcome)
    }

    @Test
    fun `a key offered before the input method and again at the Activity counts once`() {
        val s = Screen(focus = "nothing")
        ticket.forEachIndexed { i, c ->
            if (i > 0) s.now += 150
            for (down in listOf(true, false)) {
                val k = ScanKey(s.now, down, KEYCODE_CHAR, c.code, hardware = true)
                assertFalse(s.burst.key(k))
                assertFalse(s.burst.key(k))
            }
        }
        s.now += 150
        val enter = ScanKey(s.now, true, KEYCODE_ENTER, 0, hardware = true)
        assertTrue(s.burst.key(enter))
        assertTrue(s.burst.key(enter))
        assertEquals(ticket, s.field.text)
        assertEquals(48, s.reports.single().chars)
    }

    // ------------------------------------------------------------- the log

    @Test
    fun `the burst rules are 8 characters and 600 ms`() {
        assertEquals(8, SCAN_MIN_CHARS)
        assertEquals(600L, SCAN_IDLE_MS)
    }

    private companion object {
        /** KeyEvent's codes: any character key, Shift, volume up. */
        const val KEYCODE_CHAR = 29
        const val KEYCODE_SHIFT_LEFT = 59
        const val KEYCODE_VOLUME_UP = 24
    }
}
