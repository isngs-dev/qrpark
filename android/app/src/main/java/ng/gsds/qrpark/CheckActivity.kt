package ng.gsds.qrpark

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import ng.gsds.qrpark.databinding.ActivityCheckBinding

/**
 * Check ticket (read-only): one focused field that a keyboard-wedge scanner
 * (or typing) fills, and a Check button. A scan only fills the field; Enter
 * never submits. Opened from the ticket screen ("Check this ticket"), it
 * checks the ticket on screen, whose token is in memory and never shown.
 *
 * Scan with camera (UI-1, A2) is the booth's and the exit's: ScanActivity
 * hands the scan back in memory (ScanHand) and deliverScan only fills the
 * field. Check stays the operator's tap.
 */
class CheckActivity : AppCompatActivity() {

    private lateinit var binding: ActivityCheckBinding
    private lateinit var session: Session
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCheckBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.padForSystemBars()
        session = Session(this)
        if (!session.isSignedIn) return openSignIn(ended = false)

        binding.scanField.enterNeverSubmits()
        binding.cameraButton.visibility = if (scannerKind(this) == ScannerKind.CAMERA) View.VISIBLE else View.GONE
        binding.cameraButton.setOnClickListener { startActivity(Intent(this, ScanActivity::class.java)) }
        binding.checkButton.setOnClickListener {
            val scanned = binding.scanField.text?.toString()?.trim().orEmpty()
            if (scanned.isEmpty()) {
                showDetail(getString(R.string.nothing_to_check))
                return@setOnClickListener
            }
            check(scanned)
        }

        val onScreen = TicketHolder.current
        if (intent.getBooleanExtra(EXTRA_SHOWN, false) && onScreen != null) {
            // The staff tapped "Check this ticket": that tap is the action.
            binding.scanLayout.visibility = View.GONE
            binding.cameraButton.visibility = View.GONE
            binding.checkButton.text = getString(R.string.check_this_ticket) + " · " + onScreen.ticketNumber
            binding.checkButton.setOnClickListener { check(onScreen.token) }
            check(onScreen.token)
        } else {
            binding.scanField.requestFocus()
        }
    }

    override fun onResume() {
        super.onResume()
        if (!::binding.isInitialized || binding.scanLayout.visibility != View.VISIBLE) return
        ScanHand.take()?.let { deliverScan(scanTarget, it) }
    }

    private val scanTarget = object : ScanTarget {
        override var text: String
            get() = binding.scanField.text?.toString().orEmpty()
            set(value) {
                binding.scanField.setText(value)
                binding.scanField.setSelection(value.length)
                binding.scanField.requestFocus()
            }

        /** A scan never calls it: the operator taps Check. */
        override fun submit() {
            binding.checkButton.performClick()
        }
    }

    private fun check(scanned: String) {
        if (busy) return
        busy = true
        binding.checkButton.isEnabled = false
        binding.banner.visibility = View.GONE
        showDetail(getString(R.string.checking))
        BackendClient.check(session, scanned) { reply ->
            busy = false
            binding.checkButton.isEnabled = true
            if (reply == CheckReply.SignInAgain) return@check openSignIn(ended = true)
            show(checkView(reply))
            if (binding.scanLayout.visibility == View.VISIBLE) {
                binding.scanField.selectAll()
                binding.scanField.requestFocus()
            }
        }
    }

    private fun show(view: CheckView) {
        binding.banner.text = view.title
        binding.banner.setBackgroundColor(
            ContextCompat.getColor(
                this,
                when (view.tone) {
                    Tone.GOOD -> R.color.good
                    Tone.BAD -> R.color.bad
                    Tone.GREY -> R.color.muted
                },
            ),
        )
        binding.banner.visibility = View.VISIBLE
        showDetail(view.detail.orEmpty())
    }

    private fun showDetail(text: String) {
        binding.detail.text = text
    }

    companion object {
        /** Check the ticket held on screen (TicketHolder), not a typed one. */
        const val EXTRA_SHOWN = "ng.gsds.qrpark.CHECK_SHOWN"
    }
}
