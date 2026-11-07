package ng.gsds.qrpark

/**
 * The backend's integer kobo, shown as naira: "₦1,234.50".
 *
 * STRING WORK ONLY. The digits of the kobo value are split two from the end
 * and grouped in threes. Nothing here divides, multiplies, rounds or converts
 * to floating point: the app shows the backend's amount, it never computes
 * one (NairaTest checks the source for it).
 */
fun naira(kobo: Long): String {
    val digits = kobo.toString()
    if (digits.startsWith("-")) return "₦?"
    val padded = digits.padStart(3, '0')
    val whole = padded.dropLast(2)
    val cents = padded.takeLast(2)
    return "₦" + groupThousands(whole) + "." + cents
}

/** "1234567" to "1,234,567", by characters. */
private fun groupThousands(digits: String): String =
    digits.reversed().chunked(3).joinToString(",").reversed()
