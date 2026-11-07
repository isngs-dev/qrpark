package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * NewTicketFlow.kt: what the entry screen does with a New ticket tap and the
 * backend's answer. A ticket is shown (and so printed) only when the backend
 * returned it; a double tap never sends twice.
 */
class NewTicketFlowTest {

    private class MemoryStore : AttemptStore {
        var saved: OpenAttempt? = null
        override fun load() = saved
        override fun save(attempt: OpenAttempt) { saved = attempt }
        override fun clear() { saved = null }
    }

    private fun flow(store: MemoryStore = MemoryStore()) = NewTicketFlow(EntryAttempts(store))

    // ------------------------------------------------ classifying the reply

    @Test
    fun `only a 2xx with a readable ticket is a created ticket`() {
        val t = sampleTicket()
        assertEquals(CreateOutcome.Created(t), classifyCreate(201, t, ""))
        assertEquals(CreateOutcome.Created(t), classifyCreate(200, t, ""))
        // 2xx we could not read: never shown as created.
        assertEquals(CreateOutcome.ServerError, classifyCreate(201, null, ""))
        assertEquals(CreateOutcome.ServerError, classifyCreate(201, sampleTicket(token = ""), ""))
        assertEquals(CreateOutcome.ServerError, classifyCreate(201, t.copy(ticketNumber = " "), ""))
        assertEquals(CreateOutcome.ServerError, classifyCreate(201, t.copy(id = ""), ""))
    }

    @Test
    fun `no connection and 5xx are never a ticket`() {
        assertEquals(CreateOutcome.NoConnection, classifyCreate(null, null, ""))
        // Even if a body happened to parse, a 5xx is not a ticket.
        for (status in listOf(500, 502, 503, 504)) {
            assertEquals(CreateOutcome.ServerError, classifyCreate(status, sampleTicket(), ""))
        }
        assertEquals(CreateOutcome.ServerError, classifyCreate(302, sampleTicket(), ""))
    }

    @Test
    fun `401 means sign in again, other 4xx are refusals with the backend's message`() {
        assertEquals(CreateOutcome.SignInAgain, classifyCreate(401, null, "Unauthorized"))
        for (status in listOf(400, 403, 404, 409)) {
            assertEquals(CreateOutcome.Refused("m$status"), classifyCreate(status, sampleTicket(), "m$status"))
        }
    }

    // ------------------------------------------------ the screen's states

    @Test
    fun `a tap sends once, and taps while it is in flight send nothing`() {
        val f = flow()
        val first = f.tap("entry-1", "CAR")
        assertNotNull(first)
        assertNull(f.tap("entry-1", "CAR"))
        assertNull(f.tap("entry-1", "BUS"))
        assertTrue(f.state is NewTicketFlow.State.Sending)
    }

    @Test
    fun `no category chosen and no open attempt sends nothing`() {
        val f = flow()
        assertNull(f.tap("entry-1", null))
        assertEquals(NewTicketFlow.State.Idle, f.state)
    }

    @Test
    fun `an open attempt is resumed even with no category chosen`() {
        val store = MemoryStore()
        val first = flow(store).let { it.tap("entry-1", "CAR")!!.also { a -> it.onOutcome(a, CreateOutcome.NoConnection) } }
        val resumed = flow(store).tap("entry-1", null)
        assertEquals(first, resumed)
    }

    @Test
    fun `the ticket is shown only when the backend returned it`() {
        val f = flow()
        val a = f.tap("entry-1", "CAR")!!
        assertEquals(NewTicketFlow.State.Shown(sampleTicket()), f.onOutcome(a, CreateOutcome.Created(sampleTicket())))
    }

    @Test
    fun `no connection says so plainly, shows no ticket, and the retry uses the same key`() {
        val f = flow()
        val a = f.tap("entry-1", "CAR")!!
        val state = f.onOutcome(a, CreateOutcome.NoConnection)
        assertTrue(state is NewTicketFlow.State.Failed)
        state as NewTicketFlow.State.Failed
        assertEquals(NO_CONNECTION_MESSAGE, state.message)
        assertTrue(state.message.contains("Cannot reach the server"))
        assertTrue(state.message.contains("will not make a second ticket"))
        assertEquals(a.key, f.tap("entry-1", "CAR")!!.key)
    }

    @Test
    fun `a server error shows no ticket and keeps the key`() {
        val f = flow()
        val a = f.tap("entry-1", "CAR")!!
        val state = f.onOutcome(a, CreateOutcome.ServerError)
        assertEquals(NewTicketFlow.State.Failed(SERVER_ERROR_MESSAGE, a), state)
        assertEquals(a.key, f.tap("entry-1", "CAR")!!.key)
    }

    @Test
    fun `a lost session asks for sign-in and keeps the key`() {
        val f = flow()
        val a = f.tap("entry-1", "CAR")!!
        assertEquals(NewTicketFlow.State.SignIn, f.onOutcome(a, CreateOutcome.SignInAgain))
        assertEquals(a.key, f.tap("entry-1", "CAR")!!.key)
    }

    @Test
    fun `a refusal shows the backend's message and the next tap is a new attempt`() {
        val f = flow()
        val a = f.tap("entry-1", "CAR")!!
        assertEquals(NewTicketFlow.State.Failed("Category retired", null), f.onOutcome(a, CreateOutcome.Refused("Category retired")))
        val b = f.tap("entry-1", "BUS")!!
        assertTrue(a.key != b.key)
        assertEquals("BUS", b.categoryCode)
    }

    @Test
    fun `after a ticket is shown the next tap is a new attempt with a new key`() {
        val f = flow()
        val a = f.tap("entry-1", "CAR")!!
        f.onOutcome(a, CreateOutcome.Created(sampleTicket()))
        val b = f.tap("entry-1", "CAR")!!
        assertTrue(a.key != b.key)
    }

    @Test
    fun `a double tap around a lost reply still sends the same key`() {
        // Tap, the reply is lost, tap twice quickly: one request, same key.
        val f = flow()
        val a = f.tap("entry-1", "CAR")!!
        f.onOutcome(a, CreateOutcome.NoConnection)
        val b = f.tap("entry-1", "CAR")
        assertNull(f.tap("entry-1", "CAR"))
        assertEquals(a.key, b!!.key)
    }
}
