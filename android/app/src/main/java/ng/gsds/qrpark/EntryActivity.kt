package ng.gsds.qrpark

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import ng.gsds.qrpark.databinding.ActivityEntryBinding

/**
 * Entry mode: pick the vehicle type, tap New ticket, and the backend creates
 * the ticket. The app sends a category code and an idempotency key; the fee
 * and every other value come back from the backend.
 *
 * The ticket is shown, and so can be printed, only when the backend returned
 * it (NewTicketFlow). With no connection or a server error the screen says
 * so. While that attempt is open, the card shows only "Unfinished <type>
 * ticket <fee>" with Finish and Discard (EntryPanel.kt): never the picker.
 */
class EntryActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEntryBinding
    private lateinit var session: Session
    private lateinit var flow: NewTicketFlow
    private var categories: List<CategoryPrice> = emptyList()

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

        binding.newTicketButton.setOnClickListener { send(flow.tap(session.username, chosen()?.code)) }
        binding.finishButton.setOnClickListener { send(flow.finish(session.username)) }
        binding.discardButton.setOnClickListener { confirmDiscard() }
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
        showView()
        loadCategories()
    }

    override fun onResume() {
        super.onResume()
        if (::flow.isInitialized && flow.state !is NewTicketFlow.State.Sending) showView()
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
                        CategoryPrice(code, c.optString("name", code), c.optLong("priceKobo"))
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
        // An unfinished attempt can still be finished without the list.
        showView()
    }

    private fun showCategories() {
        val rows = listOf(getString(R.string.choose_vehicle_type)) + categories.map { it.name }
        binding.categoryPicker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, rows)
        binding.categoryPicker.setSelection(selectedRow(codes(), null))
        binding.newTicketButton.isEnabled = true
        binding.message.text = if (categories.isEmpty()) getString(R.string.no_categories) else ""
        showFee()
        showView()
    }

    private fun codes() = categories.map { it.code }

    private fun chosen(): CategoryPrice? {
        val code = codeAt(binding.categoryPicker.selectedItemPosition, codes(), null) ?: return null
        return categories.firstOrNull { it.code == code }
    }

    /** The backend's price for the chosen type, as it sent it. */
    private fun showFee() {
        binding.fee.text = chosen()?.let { getString(R.string.fee_is, naira(it.priceKobo)) } ?: ""
    }

    /** The picker, or (while an attempt is open) only the unfinished panel: EntryPanel.kt. */
    private fun showView() {
        val view = entryView(session.attempts.open(session.username), categories)
        binding.pickerGroup.visibility = if (view.showsPicker) View.VISIBLE else View.GONE
        binding.unfinishedPanel.visibility = if (view.showsPicker) View.GONE else View.VISIBLE
        if (view is EntryView.Unfinished) binding.unfinishedTitle.text = view.title
        val idle = flow.state !is NewTicketFlow.State.Sending
        binding.finishButton.isEnabled = idle
        binding.discardButton.isEnabled = idle
    }

    private fun confirmDiscard() {
        AlertDialog.Builder(this)
            .setMessage(DISCARD_CONFIRM)
            .setPositiveButton(R.string.discard) { _, _ ->
                if (flow.discard(session.username)) {
                    binding.message.text = ""
                    binding.categoryPicker.setSelection(selectedRow(codes(), null))
                    showFee()
                }
                showView()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun send(attempt: OpenAttempt?) {
        if (attempt == null) {
            if (flow.state !is NewTicketFlow.State.Sending) binding.message.setText(R.string.choose_first)
            return
        }
        binding.newTicketButton.isEnabled = false
        showView()
        binding.message.setText(R.string.creating_ticket)
        BackendClient.createTicket(session, attempt) { outcome ->
            binding.newTicketButton.isEnabled = true
            val state = flow.onOutcome(attempt, outcome)
            showView()
            when (state) {
                is NewTicketFlow.State.Shown -> {
                    TicketHolder.current = state.ticket
                    binding.message.text = ""
                    binding.categoryPicker.setSelection(selectedRow(codes(), null))
                    showFee()
                    startActivity(Intent(this, TicketActivity::class.java))
                }
                is NewTicketFlow.State.Failed -> binding.message.text = state.message
                NewTicketFlow.State.SignIn -> openSignIn(ended = true)
                NewTicketFlow.State.Idle, is NewTicketFlow.State.Sending -> Unit
            }
        }
    }
}
