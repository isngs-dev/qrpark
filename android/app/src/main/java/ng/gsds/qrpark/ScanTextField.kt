package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/dispenser/app/src/main/java/ng/eparking/dispenser/ScanTextField.kt; package changed only.

import android.content.Context
import android.content.ContextWrapper
import android.util.AttributeSet
import android.view.KeyEvent
import com.google.android.material.textfield.TextInputEditText

/**
 * A gate screen's text field - the scan fields and the Entry plate - whose
 * keys the screen's scanner capture (ScannerKeys) sees BEFORE the input
 * method does. An input method may take a hardware keyboard's keys and type
 * the text itself, and the Activity would then never see a scan arriving in
 * this field. Every key still reaches the field as before, except the Enter
 * or Tab that ends a burst.
 */
class ScanTextField(context: Context, attrs: AttributeSet?) : TextInputEditText(context, attrs) {

    override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean =
        screen()?.scanKeys?.dispatch(event) == true || super.dispatchKeyEventPreIme(event)

    private fun screen(): ScanKeyScreen? {
        var c: Context? = context
        while (c is ContextWrapper) {
            if (c is ScanKeyScreen) return c
            c = c.baseContext
        }
        return null
    }
}
