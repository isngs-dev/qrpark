package ng.gsds.qrpark

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * What the entry ticket says: the header (TicketHeader.kt), the QR - the
 * token, exactly as the backend returned it - and the ticket's facts. The
 * same paper on screen and in print, and on a reprint (the same QR).
 *
 * Every value is the backend's: the fee is its integer kobo, formatted here
 * and never computed; the issue time is its UTC instant, shown in
 * Africa/Lagos. Free of Android imports, so the rules run on the JVM.
 *
 * Adapted from eparking 359c0c1 android/pos/.../CounterPaper.kt (the
 * TicketReprint paper: header + one QR + monospace lines). The receipt, the
 * visit and the pass papers are not copied: this app prints one ticket.
 */
data class TicketPaper(
    val header: HeaderText,
    /** The QR content. Drawn as a QR only; never printed as text. */
    val qrToken: String,
    val lines: List<String>,
) {
    override fun toString() = "TicketPaper(${lines.firstOrNull { it.startsWith("Ticket") }})"
}

const val TICKET_FOOTER = "Pay at the payment booth. Show this ticket at the exit."

fun ticketPaper(t: IssuedTicket): TicketPaper = TicketPaper(
    header = t.header,
    qrToken = t.token,
    lines = listOf(
        "Vehicle  ${t.categoryName}",
        "Fee      ${naira(t.feeKobo)}",
        "Issued   ${lagosTime(t.issuedAt)}",
        "Valid today only",
        "Ticket   ${t.ticketNumber}",
        "Entry    ${t.gateName}",
        "",
        "Pay at the payment booth.",
        "Show this ticket at the exit.",
    ),
)

private val LAGOS: ZoneId = ZoneId.of("Africa/Lagos")
private val SHOWN: DateTimeFormatter = DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm", Locale.UK).withZone(LAGOS)

/** The backend's UTC instant, shown in Africa/Lagos: "07 Nov 2026 14:05". "?" if unreadable. */
fun lagosTime(iso: String): String = try {
    SHOWN.format(Instant.parse(iso))
} catch (_: DateTimeParseException) {
    "?"
}
