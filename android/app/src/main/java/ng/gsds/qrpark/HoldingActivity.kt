package ng.gsds.qrpark

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import ng.gsds.qrpark.databinding.ActivityHoldingBinding

/**
 * For every account whose job has no screen in this build (booth in 4b, exit
 * in 4c, admin in the Admin Portal). It shows the job and Sign out, and never
 * an entry screen.
 */
class HoldingActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val binding = ActivityHoldingBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.padForSystemBars()
        val session = Session(this)
        if (!session.isSignedIn) return openSignIn(ended = false)
        if (session.mode.opensEntry) return openHome(session)

        binding.who.text = listOf(session.name, session.gateName).filter { it.isNotBlank() }.joinToString(" · ")
        binding.holding.text = holdingText(session.mode)
        binding.signOutButton.setOnClickListener {
            BackendClient.logout(session) {}
            openSignIn(ended = false)
        }
    }
}
