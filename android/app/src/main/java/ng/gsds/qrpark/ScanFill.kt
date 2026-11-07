package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/dispenser/app/src/main/java/ng/eparking/dispenser/ScanFill.kt; package changed, CodeScanner (with Unready) dropped, the ScannerKind comment pointed at this app's chooser.

/**
 * What a camera scan does to a credential field: it FILLS it, and nothing else.
 *
 * The gate's camera scan stands in for a hardware scanner, and a hardware
 * scanner types a code into the focused field. So does this. It never submits,
 * never checks a ticket and never opens the barrier - Check ticket and Present
 * at barrier stay separate taps, and the exit screen's rules about what
 * survives between vehicles (ExitScreenState.kt) are untouched, because the
 * field is the only thing a scan changes.
 *
 * The scanned code is the presented credential, so it REPLACES whatever was in
 * the field - a half-typed code, or the last car's - rather than being added
 * to it. An empty or failed read changes nothing.
 */
fun fieldAfterScan(current: String, scanned: String?): String =
    scanned?.trim()?.takeIf { it.isNotEmpty() } ?: current

/** A screen's credential field, and the tap that acts on it. */
interface ScanTarget {
    var text: String

    /** Admit on pass card, Check ticket. A scan never calls it. */
    fun submit()
}

/**
 * The one way a scan's result reaches a screen, from any scanner: it fills
 * the field and stops. Submitting stays the operator's tap.
 */
fun deliverScan(target: ScanTarget, scanned: String?) {
    target.text = fieldAfterScan(target.text, scanned)
}

/**
 * Which scanner Scan with camera uses, chosen by what the device can do
 * (scannerKind in ScanActivity.kt): never by its model.
 */
enum class ScannerKind {
    /** This device's camera, through CameraX (ScanActivity). */
    CAMERA,

    /** Neither: the buttons are hidden and the code is typed. */
    NONE,
}

// ------------------------------------------------ a scanner that types

/*
 * A scanning module that works as a keyboard types the code into the focused
 * field and usually ends it with Enter (or Tab). Left to Android, that key
 * would move focus out of the field to the next button - and the NEXT scan's
 * Enter would press it: Admit on pass card, or Present at barrier. So in a
 * credential field those keys are held there: they select what is in the
 * field (so the next scan replaces it, as fieldAfterScan does) and do nothing
 * else. Typed or injected characters go into the field as ever.
 *
 * Behind this, each gate screen catches the scanner's burst itself, whatever
 * has focus, and consumes the Enter that ends it (ScanBurst.kt).
 */

/** android.view.KeyEvent's codes for the keys that end a scan. */
const val KEYCODE_TAB = 61
const val KEYCODE_ENTER = 66
const val KEYCODE_NUMPAD_ENTER = 160
const val KEYCODE_DPAD_CENTER = 23

enum class FieldKey {
    /** The field handles it: a character typed or injected. */
    TYPE,

    /** Kept in the field: select its text, and nothing more - never submit, never move focus. */
    HOLD,
}

/** What a key arriving in a credential field does (Android wiring: holdScannerKeys). */
fun credentialFieldKey(keyCode: Int): FieldKey = when (keyCode) {
    KEYCODE_ENTER, KEYCODE_NUMPAD_ENTER, KEYCODE_TAB, KEYCODE_DPAD_CENTER -> FieldKey.HOLD
    else -> FieldKey.TYPE
}
