package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/dispenser/app/src/main/java/ng/eparking/dispenser/ScanBurst.kt; package changed, the log-line helpers (keyKind, scannerKeyLogLine, burstLogLine) removed, gate wording in comments made general. Nothing here logs.

/**
 * A scan from a scanning module that types like a keyboard, caught at the
 * screen whatever has focus (ScannerKeys.kt wires it to the Activity's
 * dispatchKeyEvent). No Android here (ScanBurstTest).
 *
 * The module types the code one key at a time - slowly, on some units
 * 100-200 ms a character - and usually ends it with Enter. Its keys come from a non-virtual device with a keyboard
 * source; the on-screen keyboard and injected keys are virtual, and are never
 * counted. Nothing here looks at a device's name or ids.
 *
 * A burst ends on Enter (or Tab, the keys credentialFieldKey holds) or on a
 * gap of [SCAN_IDLE_MS]. It is a scan only with at least [SCAN_MIN_CHARS]
 * characters, so ordinary typing, power and volume keys are left alone. A
 * scan goes to the screen's scan field through deliverScan - the camera's own
 * path - which SETS the field to the code: when the focused field typed the
 * same keys itself, the result is still the code once, never twice.
 *
 * A scan only fills the field. The Enter or Tab that ends a burst is consumed
 * here, DOWN and UP, so it never presses a focused button: never Check
 * or a payment button.
 */

/** Fewer characters than this is typing, not a scan. */
const val SCAN_MIN_CHARS = 8

/** A gap this long or longer ends a burst. */
const val SCAN_IDLE_MS = 600L

/** One key event, as the burst sees it. */
data class ScanKey(
    /** The event's own time (uptime, ms). With [down] and [keyCode] it tells one event from another. */
    val atMs: Long,
    val down: Boolean,
    val keyCode: Int,
    /** The character it types, 0 for none. */
    val char: Int,
    /** From a non-virtual device with a keyboard source. Only these are counted. */
    val hardware: Boolean,
)

/** A field staff type in by hand, which a scan must stay out of: Find by number. */
interface TypingField {
    var text: String
}

/** What a screen offers a scan. */
interface ScanScreen {
    /** Where a scan goes now; null when no scan field is on screen, and the scan is dropped. */
    fun scanField(): ScanTarget?

    /** A typing field that has focus now, or null. */
    fun focusedTypingField(): TypingField? = null
}

enum class BurstEnd { ENTER, IDLE }

/** What became of a burst. */
enum class BurstOutcome {
    /** Into the scan field. */
    FILLED,

    /** Typed into a typing field, which was put back; the scan went to the scan field. */
    MOVED_OUT_OF_TYPING_FIELD,

    /** Under SCAN_MIN_CHARS: typing, left as it was. */
    TOO_SHORT,

    /** In a typing field with no Enter: plain typing, left as it was. */
    LEFT_AS_TYPED,

    /** No scan field on screen: dropped, silently. */
    DROPPED,
}

/** A burst for the log: counts and times only - never the characters. */
data class BurstReport(val chars: Int, val end: BurstEnd, val tookMs: Long, val longestGapMs: Long, val outcome: BurstOutcome)

class ScanBurst(private val screen: ScanScreen, private val report: (BurstReport) -> Unit = {}) {

    private val code = StringBuilder()
    private var firstAt = 0L
    private var lastAt = 0L
    private var longestGap = 0L

    /** The typing field that had focus when the burst began, and what it held then. */
    private var typing: TypingField? = null
    private var typingBefore = ""

    /** The end key whose DOWN was consumed: its UP is consumed too. */
    private var heldUp: Int? = null

    /**
     * The last key and what was decided. A key in a text field is offered
     * before the input method sees it (ScanTextField) and, when the input
     * method passes it on, again at the Activity: the same event, counted once.
     */
    private var last: ScanKey? = null
    private var lastVerdict = false

    val inProgress: Boolean get() = code.isNotEmpty()

    /** True when the key is consumed here; false sends it on to the screen as usual. */
    /** Whether [k] is the event just offered, seen again. */
    fun isRepeat(k: ScanKey): Boolean = k == last

    fun key(k: ScanKey): Boolean {
        if (k == last) return lastVerdict
        last = k
        lastVerdict = decide(k)
        return lastVerdict
    }

    private fun decide(k: ScanKey): Boolean {
        if (!k.hardware) return false
        if (!k.down) {
            if (k.keyCode != heldUp) return false
            heldUp = null
            return true
        }
        if (inProgress && k.atMs - lastAt >= SCAN_IDLE_MS) finish(BurstEnd.IDLE)
        if (credentialFieldKey(k.keyCode) == FieldKey.HOLD) {
            if (!inProgress) return false
            heldUp = k.keyCode
            finish(BurstEnd.ENTER)
            return true
        }
        if (!printable(k.char)) return false
        if (inProgress) {
            longestGap = maxOf(longestGap, k.atMs - lastAt)
        } else {
            firstAt = k.atMs
            longestGap = 0
            typing = screen.focusedTypingField()
            typingBefore = typing?.text.orEmpty()
        }
        code.appendCodePoint(k.char)
        lastAt = k.atMs
        return false
    }

    /** The idle timer: a burst with no key for SCAN_IDLE_MS is over. */
    fun idle(nowMs: Long) {
        if (inProgress && nowMs - lastAt >= SCAN_IDLE_MS) finish(BurstEnd.IDLE)
    }

    /** The screen is going away: a half burst is forgotten. */
    fun reset() {
        code.clear()
        typing = null
        heldUp = null
    }

    private fun finish(end: BurstEnd) {
        val scanned = code.toString()
        val typedIn = typing
        code.clear()
        typing = null
        val outcome = when {
            scanned.length < SCAN_MIN_CHARS -> BurstOutcome.TOO_SHORT
            typedIn != null && end == BurstEnd.IDLE -> BurstOutcome.LEFT_AS_TYPED
            else -> {
                // Scanner keys stay out of a typing field: it gets back what it held.
                typedIn?.text = typingBefore
                val target = screen.scanField()
                when {
                    target == null -> BurstOutcome.DROPPED
                    else -> {
                        deliverScan(target, scanned)
                        if (typedIn != null) BurstOutcome.MOVED_OUT_OF_TYPING_FIELD else BurstOutcome.FILLED
                    }
                }
            }
        }
        report(BurstReport(scanned.length, end, lastAt - firstAt, longestGap, outcome))
    }

    private fun printable(c: Int): Boolean = c >= 0x20 && c != 0x7f && c !in 0x80..0x9f
}
