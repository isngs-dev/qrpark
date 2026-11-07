package ng.gsds.qrpark

/**
 * The header on the printed ticket and on the ticket screen.
 *
 * The GSD logo on the left, the AIC logo on the right, and between them the
 * brand line - the site's organisation name, else its display name - with the
 * contact line beneath. Both are edited in the Admin Portal and come with the
 * ticket from the backend. The ticket never says "E-Parking".
 *
 * When either line will not fit on one line between the logos at its normal
 * size, the logos keep their row and the lines move beneath it, centred and
 * wrapped at spaces. Text is never shrunk to make it fit: a ticket a customer
 * cannot read is worse than a taller one.
 *
 * No Android here, so the rules run on the JVM. The renderer measures with
 * its own paint and draws what [headerPlan] says.
 *
 * Copied from eparking 359c0c1 android/pos/.../TicketHeader.kt (the logo order,
 * INLINE/STACKED and wrapWords unchanged) and adapted: the fixed "E-Parking"
 * title and siteDisplayName() are replaced by [HeaderText] (organisation name,
 * else display name, and the contact line).
 */

enum class HeaderLogo { GSD, AIC }

/** Which logo stands on the left, and which on the right. */
val HEADER_LOGO_LEFT = HeaderLogo.GSD
val HEADER_LOGO_RIGHT = HeaderLogo.AIC

/** The header's two lines: [brand] ("" for none) and [contact] (null for none). */
data class HeaderText(val brand: String, val contact: String?) {
    companion object {
        /** From the ticket's `header`: receiptOrgName, else displayName; receiptContactLine. */
        fun of(displayName: String?, orgName: String?, contactLine: String?): HeaderText =
            HeaderText(brand = shown(orgName) ?: shown(displayName) ?: "", contact = shown(contactLine))

        private fun shown(value: String?): String? =
            value?.trim()?.takeIf { it.isNotEmpty() && it != "null" }
    }
}

enum class HeaderLayout {
    /** Logos left and right, the lines between them. */
    INLINE,

    /** The logos' row on top, the lines centred beneath it. */
    STACKED,
}

/** How a header is laid out, and its lines as the renderer draws them. */
data class HeaderPlan(val layout: HeaderLayout, val brandLines: List<String>, val contactLines: List<String>)

/**
 * Lays out one header. [middle] is the room between the two logo slots,
 * [full] the whole width. INLINE only when each line fits between the logos;
 * otherwise STACKED, each line wrapped at word boundaries across [full].
 */
fun headerPlan(
    text: HeaderText,
    middle: Float,
    full: Float,
    measureBrand: (String) -> Float,
    measureContact: (String) -> Float,
): HeaderPlan {
    val brand = text.brand.trim()
    val contact = text.contact?.trim().orEmpty()
    val fitsBrand = brand.isEmpty() || measureBrand(brand) <= middle
    val fitsContact = contact.isEmpty() || measureContact(contact) <= middle
    if (fitsBrand && fitsContact) {
        return HeaderPlan(HeaderLayout.INLINE, listOfNotNull(brand.ifEmpty { null }), listOfNotNull(contact.ifEmpty { null }))
    }
    return HeaderPlan(
        HeaderLayout.STACKED,
        if (brand.isEmpty()) emptyList() else wrapWords(brand, full, measureBrand),
        if (contact.isEmpty()) emptyList() else wrapWords(contact, full, measureContact),
    )
}

/**
 * Breaks [text] into lines no wider than [width], at spaces.
 *
 * A single word wider than the line is broken between characters rather than
 * cut: every character reaches the paper.
 */
fun wrapWords(text: String, width: Float, measure: (String) -> Float): List<String> {
    val lines = mutableListOf<String>()
    var line = ""
    for (word in text.trim().split(Regex("\\s+"))) {
        val joined = if (line.isEmpty()) word else "$line $word"
        if (measure(joined) <= width) {
            line = joined
            continue
        }
        if (line.isNotEmpty()) lines += line
        line = word
        while (line.length > 1 && measure(line) > width) {
            var cut = line.length - 1
            while (cut > 1 && measure(line.take(cut)) > width) cut--
            lines += line.take(cut)
            line = line.drop(cut)
        }
    }
    if (line.isNotEmpty()) lines += line
    return lines
}
