package ng.gsds.qrpark

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import androidx.appcompat.app.AppCompatActivity
import ng.gsds.qrpark.databinding.ActivityEntryBinding

/**
 * Entry mode: pick the vehicle type, tap New ticket, and the backend creates
 * the ticket. The app sends a category code and an idempotency key; the fee
 * and every other value come back from the backend.
 *
 * The ticket is shown, and so can be printed, only when the backend returned
 * it (NewTicketFlow). With no connection or a server error the screen says
 * so and the next tap retries with the same key.
 */
class EntryActivity : AppCompatActivity() {

    private class Category(val code: String, val name: String, val priceKobo: Long)

    private lateinit var binding: ActivityEntryBinding
    private lateinit var session: Session
    private lateinit var flow: NewTicketFlow
    private var categories: List<Category> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEntryBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.padForSystemBars()
        session = Session(this)
        if (!session.isSignedIn) return openSignIn(ended = false)
        if (!session.mode.opensEntry) return openHome(session)
        flow = NewTicketFlow(session.attempts)

        binding.whoWhere.text = getString(R.string.signed_in_as, session.name, session.gateName)
        binding.site.text = session.siteName

        binding.newTicketButton.setOnClickListener { newTicket() }
        binding.reloadButton.setOnClickListener { loadCategories() }
        binding.todayButton.setOnClickListener { startActivity(TicketsActivity.today(this)) }
        binding.findButton.setOnClickListener { startActivity(TicketsActivity.lookup(this)) }
        binding.checkButton.setOnClickListener { startActivity(Intent(this, CheckActivity::class.java)) }
        binding.signOutButton.setOnClickListener {
            BackendClient.logout(session) {}
            openSignIn(ended = false)
        }
        binding.categoryPicker.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) = showFee()
            override fun onNothingSelected(parent: AdapterView<*>?) = showFee()
        }
        loadCategories()
    }

    override fun onResume() {
        super.onResume()
        if (::flow.isInitialized && flow.state !is NewTicketFlow.State.Sending) showOpenAttempt()
    }

    private fun loadCategories() {
        binding.reloadButton.visibility = View.GONE
        binding.newTicketButton.isEnabled = false
        binding.message.setText(R.string.loading_categories)
        BackendClient.categories(session) { reply ->
            when {
                reply.status == 401 -> return@categories openSignIn(ended = true)
                reply.status == null -> showLoadProblem(getString(R.string.cannot_reach))
                !reply.ok -> showLoadProblem(reply.message)
                else -> {
                    val array = reply.array()
                    categories = (0 until (array?.length() ?: 0)).mapNotNull { i ->
                        val c = array!!.optJSONObject(i) ?: return@mapNotNull null
                        val code = c.optStringOrNull("code") ?: return@mapNotNull null
                        if (!c.has("priceKobo")) return@mapNotNull null
                        Category(code, c.optString("name", code), c.optLong("priceKobo"))
                    }
                    if (array == null) showLoadProblem(SERVER_ERROR_MESSAGE) else showCategories()
                }
            }
        }
    }

    private fun showLoadProblem(message: String) {
        binding.message.text = message
        binding.reloadButton.visibility = View.VISIBLE
        binding.newTicketButton.isEnabled = false
        // An unfinished attempt can still be retried without the list.
        session.attempts.open(session.username)?.let {
            binding.message.text = message + "\n\n" + getString(R.string.open_attempt, it.categoryCode)
            binding.newTicketButton.isEnabled = true
        }
    }

    private fun showCategories() {
        val rows = listOf(getString(R.string.choose_vehicle_type)) + categories.map { it.name }
        binding.categoryPicker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, rows)
        binding.categoryPicker.setSelection(selectedRow(codes(), null))
        binding.newTicketButton.isEnabled = true
        binding.message.text = if (categories.isEmpty()) getString(R.string.no_categories) else ""
        showFee()
        showOpenAttempt()
    }

    private fun codes() = categories.map { it.code }

    private fun chosen(): Category? {
        val code = codeAt(binding.categoryPicker.selectedItemPosition, codes(), null) ?: return null
        return categories.firstOrNull { it.code == code }
    }

    /** The backend's price for the chosen type, as it sent it. */
    private fun showFee() {
        binding.fee.text = chosen()?.let { getString(R.string.fee_is, naira(it.priceKobo)) } ?: ""
    }

    private fun showOpenAttempt() {
        val open = session.attempts.open(session.username) ?: return
        val name = categories.firstOrNull { it.code == open.categoryCode }?.name ?: open.categoryCode
        binding.message.text = getString(R.string.open_attempt, name)
        binding.newTicketButton.isEnabled = true
    }

    private fun newTicket() {
        val attempt = flow.tap(session.username, chosen()?.code)
        if (attempt == null) {
            if (flow.state !is NewTicketFlow.State.Sending) binding.message.setText(R.string.choose_first)
            return
        }
        binding.newTicketButton.isEnabled = false
        binding.message.setText(R.string.creating_ticket)
        BackendClient.createTicket(session, attempt) { outcome ->
            binding.newTicketButton.isEnabled = true
            when (val state = flow.onOutcome(attempt, outcome)) {
                is NewTicketFlow.State.Shown -> {
                    TicketHolder.current = state.ticket
                    binding.message.text = ""
                    binding.categoryPicker.setSelection(selectedRow(codes(), null))
                    startActivity(Intent(this, TicketActivity::class.java))
                }
                is NewTicketFlow.State.Failed -> binding.message.text = state.message
                NewTicketFlow.State.SignIn -> openSignIn(ended = true)
                NewTicketFlow.State.Idle, is NewTicketFlow.State.Sending -> Unit
            }
        }
    }
}
