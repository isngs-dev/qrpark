package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * EntryPanel.kt (A4a-1): while an entry attempt is open the screen shows only
 * "Unfinished <type> ticket <fee>" with Finish and Discard; the picker and its
 * fee are hidden, so the screen never shows one type while issuing another.
 */
class EntryPanelTest {

    private class MemoryStore : AttemptStore {
        var saved: OpenAttempt? = null
        override fun load() = saved
        override fun save(attempt: OpenAttempt) { saved = attempt }
        override fun clear() { saved = null }
    }

    private val types = listOf(CategoryPrice("CAR", "Car", 50_000), CategoryPrice("LORRY", "Lorry", 120_000))

    @Test
    fun `no open attempt shows the picker`() {
        assertEquals(EntryView.Picker, entryView(null, types))
    }

    @Test
    fun `an open attempt shows only the unfinished panel, with its own type and fee`() {
        val v = entryView(OpenAttempt("entry-1", "k".repeat(20), "LORRY"), types)
        assertEquals(EntryView.Unfinished("Lorry", "₦1,200.00"), v)
        assertFalse(v.showsPicker)
        assertEquals("Unfinished Lorry ticket ₦1,200.00", (v as EntryView.Unfinished).title)
    }

    @Test
    fun `a type no longer listed (or no list yet) shows its code and no fee`() {
        val v = entryView(OpenAttempt("entry-1", "k".repeat(20), "VAN"), types)
        assertEquals(EntryView.Unfinished("VAN", null), v)
        assertEquals("Unfinished VAN ticket", (v as EntryView.Unfinished).title)
        assertEquals(EntryView.Unfinished("LORRY", null), entryView(OpenAttempt("entry-1", "k".repeat(20), "LORRY"), emptyList()))
    }

    @Test
    fun `only the picker view shows the picker`() {
        assertTrue(EntryView.Picker.showsPicker)
        assertFalse(EntryView.Unfinished("Car", null).showsPicker)
    }

    @Test
    fun `Finish sends the open attempt, whatever was chosen before`() {
        val store = MemoryStore()
        val flow = NewTicketFlow(EntryAttempts(store))
        val open = flow.tap("entry-1", "LORRY")!!
        flow.onOutcome(open, CreateOutcome.NoConnection)
        assertEquals(open, flow.finish("entry-1"))
    }

    @Test
    fun `Discard ends the open attempt - the next ticket gets a new key and the picker is back`() {
        val store = MemoryStore()
        val flow = NewTicketFlow(EntryAttempts(store))
        val open = flow.tap("entry-1", "LORRY")!!
        flow.onOutcome(open, CreateOutcome.NoConnection)
        assertTrue(flow.discard("entry-1"))
        assertNull(store.saved)
        assertEquals(EntryView.Picker, entryView(store.saved, types))
        val next = flow.tap("entry-1", "CAR")!!
        assertNotEquals(open.key, next.key)
        assertEquals("CAR", next.categoryCode)
    }

    @Test
    fun `Discard is refused while the attempt's request is in flight`() {
        val store = MemoryStore()
        val flow = NewTicketFlow(EntryAttempts(store))
        val sending = flow.tap("entry-1", "LORRY")!!
        assertFalse(flow.discard("entry-1"))
        assertEquals(sending, store.saved)
    }

    @Test
    fun `Discard touches only this account's attempt`() {
        val store = MemoryStore()
        val attempts = EntryAttempts(store)
        val open = attempts.begin("entry-1", "LORRY")
        assertFalse(NewTicketFlow(attempts).discard("entry-2"))
        assertEquals(open, store.saved)
    }

    @Test
    fun `the discard confirmation says what may be left on the server`() {
        assertTrue(DISCARD_CONFIRM.contains("one UNPAID ticket"))
        assertTrue(DISCARD_CONFIRM.contains("harmless"))
    }
}
