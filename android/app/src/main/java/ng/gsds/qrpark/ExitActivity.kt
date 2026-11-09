package ng.gsds.qrpark

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import ng.gsds.qrpark.databinding.ActivityExitBinding

/**
 * Exit mode (docs/01-flow.md section 3): the focused scan field (wedge or
 * camera; a scan only fills it, Enter never submits), Validate (one request at
 * a time), the answer in large type and colour, and Next. Check is read-only.
 *
 * Every decision about what is shown is in ExitRules.kt: green "Valid — allow
 * exit" only for the backend's VALID; grey "Cannot verify" on no connection,
 * 503 or 5xx; no retry by itself. The scanned text is held in memory only and
 * never shown (the field is masked), stored or logged.
 *
 * The scanner pieces are the booth's (ScanTextField, ScannerKeys, ScanActivity
 * and its in-memory hand-off, ScanHand).
 */
class ExitActivity : AppCompatActivity(), ScanScreen, ScanKeyScreen {

    private lateinit var binding: ActivityExitBinding
    private lateinit var session: Session
    override lateinit var scanKeys: ScannerKeys
    private val flow = ExitFlow()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityExitBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.padForSystemBars()
        session = Session(this)
        if (!session.isSignedIn) return openSignIn(ended = false)
        if (!session.mode.opensExit) return openHome(session)
        scanKeys = ScannerKeys(this)

        binding.whoWhere.text = getString(R.string.signed_in_as, session.name, session.gateName)
        binding.site.text = session.siteName
        binding.scanField.enterNeverSubmits()
        binding.cameraButton.visibility = if (scannerKind(this) == ScannerKind.CAMERA) View.VISIBLE else View.GONE

        binding.validateButton.setOnClickListener { validate() }
        binding.checkButton.setOnClickListener { check() }
        binding.cameraButton.setOnClickListener { startActivity(Intent(this, ScanActivity::class.java)) }
        binding.nextButton.setOnClickListener { next() }
        binding.signOutButton.setOnClickListener {
            BackendClient.logout(session) {}
            openSignIn(ended = false)
        }
        binding.scanField.requestFocus()
    }

    override fun onResume() {
        super.onResume()
        if (!::scanKeys.isInitialized) return
        ScanHand.take()?.let { deliverScan(scanTarget, it) }
    }

    override fun onPause() {
        super.onPause()
        if (::scanKeys.isInitialized) scanKeys.stop()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        (::scanKeys.isInitialized && scanKeys.dispatch(event)) || super.dispatchKeyEvent(event)

    private val scanTarget = object : ScanTarget {
        override var text: String
            get() = binding.scanField.text?.toString().orEmpty()
            set(value) {
                binding.scanField.setText(value)
                binding.scanField.setSelection(value.length)
                binding.scanField.requestFocus()
            }

        /** A scan never calls it: the operator taps Validate. */
        override fun submit() = validate()
    }

    override fun scanField(): ScanTarget? = scanTarget

    private fun scanned(): String = binding.scanField.text?.toString()?.trim().orEmpty()

    /** One request at a time; never retried by itself. */
    private fun validate() {
        val text = scanned()
        if (!flow.tapValidate(text)) return
        busy(true)
        BackendClient.validate(session, text) { reply ->
            busy(false)
            if (reply == CheckReply.SignInAgain) return@validate openSignIn(ended = true)
            show(flow.onReply(reply))
        }
    }

    /** Read-only: the same words as Check in every mode (CheckView.kt). */
    private fun check() {
        val text = scanned()
        if (!flow.tapCheck(text)) return
        busy(true)
        BackendClient.check(session, text) { reply ->
            busy(false)
            flow.onCheckReply()
            if (reply == CheckReply.SignInAgain) return@check openSignIn(ended = true)
            val view = checkView(reply)
            banner(
                view.title,
                when (view.tone) {
                    Tone.GOOD -> R.color.good
                    Tone.BAD -> R.color.bad
                    Tone.GREY -> R.color.muted
                },
            )
            binding.detail.text = view.detail.orEmpty()
            binding.nextButton.visibility = View.VISIBLE
        }
    }

    private fun show(view: ExitView) {
        banner(
            view.title,
            when (view.tone) {
                ExitTone.GREEN -> R.color.good
                ExitTone.RED -> R.color.bad
                ExitTone.GREY -> R.color.muted
            },
        )
        binding.detail.text = view.lines.joinToString("\n")
        // After "Cannot verify" the (masked) scan stays for Validate again; otherwise it goes.
        if (!flow.keepsField(view)) binding.scanField.text = null
        binding.nextButton.visibility = View.VISIBLE
    }

    private fun banner(text: String, colour: Int) {
        binding.banner.text = text
        binding.banner.setBackgroundColor(ContextCompat.getColor(this, colour))
        binding.banner.visibility = View.VISIBLE
    }

    private fun busy(on: Boolean) {
        binding.validateButton.isEnabled = !on
        binding.checkButton.isEnabled = !on
        if (on) {
            binding.banner.visibility = View.GONE
            binding.detail.setText(R.string.checking)
        }
    }

    /** Next: clear the screen and refocus the field. */
    private fun next() {
        flow.next()
        binding.scanField.text = null
        binding.banner.visibility = View.GONE
        binding.detail.text = ""
        binding.nextButton.visibility = View.GONE
        binding.scanField.requestFocus()
    }
}
