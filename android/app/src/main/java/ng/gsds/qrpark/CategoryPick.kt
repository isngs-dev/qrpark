package ng.gsds.qrpark

/**
 * Which row of the vehicle-type picker is selected, and what code that row
 * means.
 *
 * A Spinner ALWAYS has a selection, so without a placeholder row 0 stands as
 * though somebody had chosen the first category. The entry screen never
 * prefills a category: it opens on the placeholder, and New ticket needs a
 * category the operator actually picked.
 *
 * Copied from eparking 359c0c1 android/pos/.../CategoryPick.kt: the three
 * functions' code unchanged; the comments that spoke of passes reworded.
 */

/**
 * Is a placeholder row needed?
 *
 * Whenever the prefill does not resolve - including when there is none, which
 * is every New ticket at entry.
 */
fun needsPlaceholder(codes: List<String>, desired: String?): Boolean =
    codes.none { it == desired?.trim() }

/** The row to select, given the list and the code being prefilled. */
fun selectedRow(codes: List<String>, desired: String?): Int {
    // Row 0 either way - but when there is no usable prefill that row is the
    // placeholder, not the first category. That is the whole difference.
    if (needsPlaceholder(codes, desired)) return 0
    return codes.indexOfFirst { it == desired?.trim() }
}

/**
 * The code at a row, or null when that row is the placeholder.
 *
 * Takes [desired] because whether a placeholder occupies row 0 depends on it -
 * and getting that offset wrong issues the ticket one category off, at the
 * wrong fee.
 */
fun codeAt(position: Int, codes: List<String>, desired: String?): String? {
    if (!needsPlaceholder(codes, desired)) return codes.getOrNull(position)
    // Row 0 is the placeholder and means no code at all; everything else
    // shifts down by one.
    return if (position <= 0) null else codes.getOrNull(position - 1)
}
