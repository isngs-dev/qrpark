package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/pos/app/src/test/.../CategoryPickTest.kt; package and the class comment changed, the tests unchanged.

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The vehicle-type picker at entry (CategoryPick.kt). The entry screen never
 * prefills a category, so it always opens on the placeholder: no ticket is
 * issued for a category nobody chose. The prefill cases are kept from
 * eparking because the functions are copied unchanged.
 */
class CategoryPickTest {

    /** As the counter loads them: active categories only, name-ordered. */
    private val codes = listOf("CAR", "BIKE", "TRICYCLE")

    // ------------------------------------------ a prefill that still resolves

    @Test
    fun `a prefill that is still offered is selected`() {
        // The ordinary case, and it must keep costing no extra tap.
        assertFalse(needsPlaceholder(codes, "BIKE"))
        assertEquals(1, selectedRow(codes, "BIKE"))
        assertEquals("BIKE", codeAt(1, codes, "BIKE"))
    }

    @Test
    fun `a prefill of the first category is still a real prefill`() {
        // Must work, and must be distinguishable from the failure that also
        // lands on row 0 - which is the whole bug.
        assertFalse(needsPlaceholder(codes, "CAR"))
        assertEquals(0, selectedRow(codes, "CAR"))
        assertEquals("CAR", codeAt(0, codes, "CAR"))
    }

    // ------------------------------------------- a prefill the site retired

    @Test
    fun `a retired prefill needs a placeholder`() {
        // THE bug. TRUCK is what the visit says; TRUCK is not on offer.
        assertTrue(needsPlaceholder(codes, "TRUCK"))
    }

    @Test
    fun `a retired prefill never resolves to the first category`() {
        // The live repro in one line: the truck must not come back as a Car.
        assertNull(codeAt(selectedRow(codes, "TRUCK"), codes, "TRUCK"))
    }

    @Test
    fun `a retired prefill selects the placeholder row`() {
        assertEquals(0, selectedRow(codes, "TRUCK"))
        assertNull(codeAt(0, codes, "TRUCK"))
    }

    // ------------------------------------------------- no prefill at all

    @Test
    fun `a fresh registration starts unchosen`() {
        // Reached from the home screen, and from Add vehicle on a Business
        // pass. Nothing has been said about this vehicle yet, so nothing may
        // be assumed about it.
        assertTrue(needsPlaceholder(codes, null))
        assertNull(codeAt(0, codes, null))
    }

    @Test
    fun `a blank prefill counts as none`() {
        // Defensive: the extra arrives as a string, and an empty one is not a
        // category.
        assertTrue(needsPlaceholder(codes, ""))
        assertTrue(needsPlaceholder(codes, "   "))
        assertNull(codeAt(0, codes, ""))
    }

    // ------------------------------- the offset, which is what gets submitted

    @Test
    fun `with a placeholder, row n is category n minus one`() {
        // The submit path reads the Spinner's position. Getting this wrong
        // registers the vehicle one category off - silently, and for good.
        assertEquals("CAR", codeAt(1, codes, "TRUCK"))
        assertEquals("BIKE", codeAt(2, codes, "TRUCK"))
        assertEquals("TRICYCLE", codeAt(3, codes, "TRUCK"))
    }

    @Test
    fun `without a placeholder, row n is category n`() {
        assertEquals("CAR", codeAt(0, codes, "BIKE"))
        assertEquals("BIKE", codeAt(1, codes, "BIKE"))
        assertEquals("TRICYCLE", codeAt(2, codes, "BIKE"))
    }

    @Test
    fun `a row past the end is no code, either way`() {
        assertNull(codeAt(3, codes, "BIKE"))
        assertNull(codeAt(4, codes, "TRUCK"))
        assertNull(codeAt(-1, codes, "BIKE"))
    }

    // --------------------------------------------------- stated as a whole

    @Test
    fun `no unchosen row ever yields a code`() {
        // So that a later change has to consider this rather than inheriting
        // permission to guess. Whatever the screen opens on, when there is no
        // usable prefill, it must not resolve to a category.
        listOf(null, "", "TRUCK", "KEKE").forEach { desired ->
            assertNull(
                "a screen prefilled with ${desired ?: "nothing"} opened on a real category",
                codeAt(selectedRow(codes, desired), codes, desired),
            )
        }
    }

    @Test
    fun `an empty list yields no code whatever is asked for`() {
        assertNull(codeAt(0, emptyList(), "CAR"))
        assertNull(codeAt(0, emptyList(), null))
    }
}
