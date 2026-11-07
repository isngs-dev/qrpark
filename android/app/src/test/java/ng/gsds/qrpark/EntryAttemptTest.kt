package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * EntryAttempt.kt: one idempotency key per New ticket attempt. Reused on every
 * retry and after a restart until the attempt ends; discarded when another
 * account signs in. The store stands in for the encrypted store on disk.
 */
class EntryAttemptTest {

    /** What the encrypted store keeps across a restart. */
    private class DiskStore : AttemptStore {
        var saved: OpenAttempt? = null
        var writes = 0
        override fun load() = saved
        override fun save(attempt: OpenAttempt) { saved = attempt; writes++ }
        override fun clear() { saved = null }
    }

    private var counter = 0
    private val keys = { "key-${++counter}-0123456789abcdef" }

    @Test
    fun `a new attempt gets a fresh, well-formed key and is stored at once`() {
        val disk = DiskStore()
        val attempt = EntryAttempts(disk).begin("entry-1", "CAR")
        assertTrue(attempt.key, isValidIdempotencyKey(attempt.key))
        assertEquals(attempt, disk.saved)
        assertEquals("entry-1", attempt.username)
        assertEquals("CAR", attempt.categoryCode)
    }

    @Test
    fun `the real key generator makes 16-100 characters of the allowed set, different every time`() {
        val made = (1..200).map { newIdempotencyKey() }
        made.forEach { assertTrue(it, isValidIdempotencyKey(it)) }
        assertEquals(200, made.toSet().size)
    }

    @Test
    fun `the key check refuses what the backend refuses`() {
        assertFalse(isValidIdempotencyKey("short"))
        assertFalse(isValidIdempotencyKey("a".repeat(101)))
        assertFalse(isValidIdempotencyKey("has space 0123456789"))
        assertTrue(isValidIdempotencyKey("a".repeat(16)))
        assertTrue(isValidIdempotencyKey("A-z_0".repeat(20)))
    }

    @Test
    fun `no connection, a server error or a lost session keep the key for the retry`() {
        val disk = DiskStore()
        val attempts = EntryAttempts(disk, keys)
        val first = attempts.begin("entry-1", "CAR")
        for (outcome in listOf(CreateOutcome.NoConnection, CreateOutcome.ServerError, CreateOutcome.SignInAgain)) {
            attempts.finish(first, outcome)
            assertEquals("after $outcome", first, attempts.begin("entry-1", "CAR"))
        }
        assertEquals(1, counter)
    }

    @Test
    fun `the key survives a restart`() {
        val disk = DiskStore()
        val before = EntryAttempts(disk, keys).begin("entry-1", "CAR")
        // The app is killed; a new process reads the same store.
        val after = EntryAttempts(disk, keys).apply { onSignedIn("entry-1") }.begin("entry-1", "CAR")
        assertEquals(before.key, after.key)
    }

    @Test
    fun `a received ticket ends the attempt, and the next one gets a new key`() {
        val disk = DiskStore()
        val attempts = EntryAttempts(disk, keys)
        val first = attempts.begin("entry-1", "CAR")
        attempts.finish(first, CreateOutcome.Created(sampleTicket()))
        assertNull(disk.saved)
        assertNotEquals(first.key, attempts.begin("entry-1", "CAR").key)
    }

    @Test
    fun `a definite refusal ends the attempt (nothing was written)`() {
        val disk = DiskStore()
        val attempts = EntryAttempts(disk, keys)
        val first = attempts.begin("entry-1", "CAR")
        attempts.finish(first, CreateOutcome.Refused("Category retired"))
        assertNull(disk.saved)
    }

    @Test
    fun `while an attempt is open a different category resumes it, with its own category`() {
        val disk = DiskStore()
        val attempts = EntryAttempts(disk, keys)
        val first = attempts.begin("entry-1", "CAR")
        attempts.finish(first, CreateOutcome.NoConnection)
        val again = attempts.begin("entry-1", "BUS")
        assertEquals(first.key, again.key)
        assertEquals("CAR", again.categoryCode)
    }

    @Test
    fun `finishing an attempt that is no longer the open one changes nothing`() {
        val disk = DiskStore()
        val attempts = EntryAttempts(disk, keys)
        val first = attempts.begin("entry-1", "CAR")
        attempts.finish(first, CreateOutcome.Created(sampleTicket()))
        val second = attempts.begin("entry-1", "CAR")
        attempts.finish(first, CreateOutcome.Created(sampleTicket()))
        assertEquals(second, disk.saved)
    }

    // ------------------------------------------- the account that owns it

    @Test
    fun `a different account signing in discards the open attempt`() {
        val disk = DiskStore()
        val attempt = EntryAttempts(disk, keys).begin("entry-1", "CAR")
        val next = EntryAttempts(disk, keys)
        next.onSignedIn("entry-2")
        assertNull(disk.saved)
        assertNull(next.open("entry-2"))
        assertNotEquals(attempt.key, next.begin("entry-2", "CAR").key)
    }

    @Test
    fun `the same account after a 401 or a restart keeps the open attempt`() {
        val disk = DiskStore()
        val attempts = EntryAttempts(disk, keys)
        val attempt = attempts.begin("entry-1", "CAR")
        attempts.finish(attempt, CreateOutcome.SignInAgain)
        attempts.onSignedIn("entry-1")
        assertEquals(attempt, attempts.open("entry-1"))
        val restarted = EntryAttempts(disk, keys).apply { onSignedIn("entry-1") }
        assertEquals(attempt, restarted.open("entry-1"))
    }

    @Test
    fun `an attempt is never handed to another account, even without a sign-in event`() {
        val disk = DiskStore()
        val attempts = EntryAttempts(disk, keys)
        val attempt = attempts.begin("entry-1", "CAR")
        assertNull(attempts.open("entry-2"))
        assertNotEquals(attempt.key, attempts.begin("entry-2", "CAR").key)
    }

    @Test
    fun `the stored attempt holds no ticket token`() {
        // Key, category and username only: the token is held in memory.
        assertEquals(
            listOf("categoryCode", "key", "username"),
            OpenAttempt::class.java.declaredFields.map { it.name }.filter { !it.startsWith("$") }.sorted(),
        )
    }
}

fun sampleTicket(token: String = "T".repeat(43)) = IssuedTicket(
    id = "6f1c2a90-6b1e-4c5d-9a7e-0b2c4d6e8f10",
    ticketNumber = "K7MP-3QZ9",
    token = token,
    categoryName = "Car",
    feeKobo = 50_000,
    issuedAt = "2026-11-07T13:05:00.000Z",
    gateName = "Test entry 1",
    header = HeaderText.of(displayName = "Garki International Market (TEST)", orgName = null, contactLine = null),
)
