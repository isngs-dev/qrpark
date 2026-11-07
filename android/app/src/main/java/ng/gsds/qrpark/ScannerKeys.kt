package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/dispenser/app/src/main/java/ng/eparking/dispenser/ScannerKeys.kt; package changed, the vendor-only key logging removed (no Log call is left).

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent

/**
 * A screen's scanner keys (ScanBurst.kt), from its dispatchKeyEvent:
 *
 *     override fun dispatchKeyEvent(event: KeyEvent) = scanKeys.dispatch(event) || super.dispatchKeyEvent(event)
 *
 * and [stop] in onPause. Every key still reaches the screen as before, except
 * the Enter or Tab that ends a burst.
 *
 * dispatchKeyEvent comes AFTER the input method, and an input method may take
 * a hardware keyboard's keys and type the text into the focused field itself
 * (the emulator's does), so the Activity never sees them. The booth's scan
 * field is therefore a ScanTextField, which offers each key here first.
 */
class ScannerKeys(screen: ScanScreen) {

    private val handler = Handler(Looper.getMainLooper())
    private val burst = ScanBurst(screen)
    private val idle = Runnable { burst.idle(SystemClock.uptimeMillis()) }

    /** True when the event is consumed. The same event offered twice counts once. */
    fun dispatch(event: KeyEvent): Boolean {
        val device = event.device
        val keyboard = event.source and InputDevice.SOURCE_KEYBOARD == InputDevice.SOURCE_KEYBOARD
        val hardware = keyboard && device != null && !device.isVirtual &&
            event.deviceId != KeyCharacterMap.VIRTUAL_KEYBOARD
        val down = event.action == KeyEvent.ACTION_DOWN
        val key = ScanKey(event.eventTime, down, event.keyCode, event.unicodeChar, hardware)
        if (burst.isRepeat(key)) return burst.key(key)
        val consumed = burst.key(key)
        handler.removeCallbacks(idle)
        if (burst.inProgress) handler.postDelayed(idle, SCAN_IDLE_MS)
        return consumed
    }

    fun stop() {
        handler.removeCallbacks(idle)
        burst.reset()
    }
}

/** A screen whose keys go to its scanner capture (ScanTextField finds it). */
interface ScanKeyScreen {
    val scanKeys: ScannerKeys
}
