package ng.gsds.qrpark

/** A vehicle type as GET /categories returns it: the backend's price, shown as sent. */
data class CategoryPrice(val code: String, val name: String, val priceKobo: Long)

/**
 * What the entry card shows (A4a-1). While an attempt is open, only the
 * unfinished panel: its own type and the backend's price for it, with
 * Finish and Discard. The picker and its fee are hidden, so the screen never
 * shows one type while New ticket would issue another.
 */
sealed interface EntryView {
    val showsPicker: Boolean

    data object Picker : EntryView {
        override val showsPicker = true
    }

    /** [fee] is null when the type is not in the list (retired, or no list yet). */
    data class Unfinished(val typeName: String, val fee: String?) : EntryView {
        override val showsPicker = false
        val title: String get() = listOfNotNull("Unfinished $typeName ticket", fee).joinToString(" ")
    }
}

fun entryView(open: OpenAttempt?, types: List<CategoryPrice>): EntryView {
    if (open == null) return EntryView.Picker
    val type = types.firstOrNull { it.code == open.categoryCode }
    return EntryView.Unfinished(type?.name ?: open.categoryCode, type?.priceKobo?.let(::naira))
}

const val DISCARD_CONFIRM =
    "Discard this unfinished ticket and start a new one? If the server already made it, " +
        "one UNPAID ticket may be left there; that is harmless."
