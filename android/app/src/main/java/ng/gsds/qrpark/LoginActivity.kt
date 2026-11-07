package ng.gsds.qrpark

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import ng.gsds.qrpark.databinding.ActivityLoginBinding

/**
 * Staff sign-in, by username. The screen that follows is the account's job
 * (Modes.kt), from the login response; access itself is decided by the
 * backend on every request.
 *
 * Adapted from eparking 359c0c1 android/pos/.../LoginActivity.kt: username in
 * place of email, the mode routing, and the backend's message or a fixed
 * sentence shown on failure (never the request).
 */
class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var session: Session

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.padForSystemBars()
        session = Session(this)

        if (session.isSignedIn) {
            session.attempts.onSignedIn(session.username)
            openHome(session)
            return
        }

        binding.serverLabel.text = getString(R.string.server_at, BuildConfig.API_BASE_URL)
        if (intent.getBooleanExtra(EXTRA_ENDED, false)) binding.message.setText(R.string.session_ended)

        binding.signInButton.setOnClickListener {
            val username = binding.usernameField.text.toString().trim()
            val password = binding.passwordField.text.toString()
            if (username.isEmpty() || password.isEmpty()) {
                binding.message.setText(R.string.enter_username_and_password)
                return@setOnClickListener
            }
            binding.signInButton.isEnabled = false
            binding.message.setText(R.string.signing_in)
            BackendClient.login(session, username, password) { reply ->
                binding.signInButton.isEnabled = true
                when {
                    reply.ok && session.isSignedIn -> {
                        binding.passwordField.text = null
                        openHome(session)
                    }
                    reply.status == null -> binding.message.setText(R.string.cannot_reach)
                    else -> binding.message.text = reply.message
                }
            }
        }
    }

    companion object {
        const val EXTRA_ENDED = "ng.gsds.qrpark.SESSION_ENDED"
    }
}
