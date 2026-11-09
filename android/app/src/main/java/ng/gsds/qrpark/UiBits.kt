package ng.gsds.qrpark

import android.app.Activity
import android.content.Intent
import android.view.KeyEvent
import android.view.View
import android.widget.EditText
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Edge to edge is enforced at this target SDK: keep content clear of the system bars. */
fun View.padForSystemBars() {
    val start = paddingLeft
    val top = paddingTop
    val end = paddingRight
    val bottom = paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
        v.setPadding(start + bars.left, top + bars.top, end + bars.right, bottom + bars.bottom)
        insets
    }
}

/**
 * Enter (from the keyboard or a keyboard-wedge scanner) never submits: the
 * field only fills, and staff tap the button to act.
 */
fun EditText.enterNeverSubmits() {
    setOnEditorActionListener { _, _, _ -> true }
    setOnKeyListener { _, keyCode, _ -> keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER }
}

/** The account's one screen: its job's (entry, booth or exit), otherwise the holding screen. */
fun Activity.openHome(session: Session) {
    val target = when {
        session.mode.opensEntry -> EntryActivity::class.java
        session.mode.opensBooth -> BoothActivity::class.java
        session.mode.opensExit -> ExitActivity::class.java
        else -> HoldingActivity::class.java
    }
    startActivity(Intent(this, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    finish()
}

/** Back to sign-in, clearing every screen. [ended] shows "Your session has ended". */
fun Activity.openSignIn(ended: Boolean) {
    TicketHolder.current = null
    startActivity(
        Intent(this, LoginActivity::class.java)
            .putExtra(LoginActivity.EXTRA_ENDED, ended)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
    )
    finish()
}
