package ng.gsds.qrpark

import java.security.SecureRandom

/**
 * The installation id, sent as `X-Device-Id` on every ticket call. Random,
 * made once and stored; the backend records it and never trusts it. It says
 * nothing about the device: no model, no serial number.
 */
private val DEVICE_ID_SHAPE = Regex("^[A-Za-z0-9_-]{1,64}$")

fun isValidDeviceId(id: String): Boolean = DEVICE_ID_SHAPE.matches(id)

/** 128 random bits as 32 hex characters. */
fun newDeviceId(random: SecureRandom = SecureRandom()): String =
    ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }

/** The stored id, or a new one (stored) when there is none or it is damaged. */
fun deviceIdFrom(load: () -> String?, save: (String) -> Unit): String {
    load()?.takeIf(::isValidDeviceId)?.let { return it }
    return newDeviceId().also(save)
}
