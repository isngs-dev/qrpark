package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** DeviceId.kt: the installation id sent as X-Device-Id (recorded, never trusted). */
class DeviceIdTest {

    @Test
    fun `a new id is random and of the header's shape`() {
        val ids = (1..200).map { newDeviceId() }
        ids.forEach { assertTrue(it, isValidDeviceId(it)) }
        assertEquals(200, ids.toSet().size)
        assertEquals(32, ids.first().length)
    }

    @Test
    fun `the shape check is the backend's`() {
        assertTrue(isValidDeviceId("a"))
        assertTrue(isValidDeviceId("A_b-9".repeat(12) + "abcd"))
        assertFalse(isValidDeviceId(""))
        assertFalse(isValidDeviceId("x".repeat(65)))
        assertFalse(isValidDeviceId("has space"))
        assertFalse(isValidDeviceId("dot.ted"))
    }

    @Test
    fun `the id is generated once and then kept`() {
        var stored: String? = null
        val first = deviceIdFrom(load = { stored }, save = { stored = it })
        val second = deviceIdFrom(load = { stored }, save = { stored = it })
        assertEquals(first, second)
        // A damaged stored value is replaced, not sent.
        stored = "bad value"
        val third = deviceIdFrom(load = { stored }, save = { stored = it })
        assertTrue(isValidDeviceId(third))
        assertEquals(third, stored)
    }
}
