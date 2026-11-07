package ng.gsds.qrpark

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import ng.gsds.qrpark.databinding.ActivityTicketsBinding
import ng.gsds.qrpark.databinding.ItemTicketBinding
import org.json.JSONArray

/**
 * Today's tickets (the operator's own) and Find by number (the last 3 or
 * more characters customers quote). Both list ticket summaries, which carry
 * no token. The operator picks one; Reprint asks the backend for that ticket
 * by its id and shows the same QR. Every miss is a plain "Not found".
 */
class TicketsActivity : AppCompatActivity() {

    private class Row(val id: String, val number: String, val category: String, val feeKobo: Long, val issuedAt: String, val state: String)

    private lateinit var binding: ActivityTicketsBinding
    private lateinit var session: Session
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityTicketsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.padForSystemBars()
        session = Session(this)
        if (!session.isSignedIn) return openSignIn(ended = false)
        if (!session.mode.opensEntry) return openHome(session)

        if (intent.getStringExtra(EXTRA_LIST) == LIST_LOOKUP) {
            binding.title.setText(R.string.find_by_number)
            binding.suffixField.enterNeverSubmits()
            binding.suffixField.requestFocus()
            binding.findButton.setOnClickListener { find() }
        } else {
            binding.title.setText(R.string.todays_tickets)
            binding.searchRow.visibility = View.GONE
            loadToday()
        }
    }

    private fun loadToday() {
        binding.message.setText(R.string.loading)
        BackendClient.recent(session) { reply ->
            when {
                reply.status == 401 -> openSignIn(ended = true)
                reply.status == null -> binding.message.setText(R.string.cannot_reach)
                !reply.ok -> binding.message.text = reply.message
                else -> show(rowsOf(reply.array()), empty = getString(R.string.none_today))
            }
        }
    }

    private fun find() {
        val suffix = binding.suffixField.text?.toString()?.trim().orEmpty()
        if (suffix.replace("-", "").length < 3) {
            binding.message.setText(R.string.at_least_three)
            return
        }
        binding.message.setText(R.string.loading)
        binding.list.removeAllViews()
        BackendClient.lookup(session, suffix) { reply ->
            when {
                reply.status == 401 -> openSignIn(ended = true)
                reply.status == null -> binding.message.setText(R.string.cannot_reach)
                reply.status == 404 || reply.status == 400 -> show(emptyList(), empty = getString(R.string.not_found))
                !reply.ok -> binding.message.text = reply.message
                else -> show(rowsOf(reply.array()), empty = getString(R.string.not_found))
            }
        }
    }

    private fun rowsOf(array: JSONArray?): List<Row> = (0 until (array?.length() ?: 0)).mapNotNull { i ->
        val o = array!!.optJSONObject(i) ?: return@mapNotNull null
        Row(
            id = o.optStringOrNull("id") ?: return@mapNotNull null,
            number = o.optString("ticketNumber"),
            category = o.optString("categoryName"),
            feeKobo = o.optLong("feeKobo"),
            issuedAt = o.optString("issuedAt"),
            state = o.optString("state"),
        )
    }

    private fun show(rows: List<Row>, empty: String) {
        binding.list.removeAllViews()
        binding.message.text = if (rows.isEmpty()) empty else ""
        for (row in rows) {
            val item = ItemTicketBinding.inflate(layoutInflater, binding.list, false)
            item.number.text = row.number
            item.detail.text = listOf(row.category, naira(row.feeKobo), lagosTime(row.issuedAt)).joinToString(" · ")
            item.state.text = row.state
            item.root.setOnClickListener { pick(row) }
            binding.list.addView(item.root)
        }
    }

    private fun pick(row: Row) {
        AlertDialog.Builder(this)
            .setTitle(row.number)
            .setMessage(listOf(row.category, naira(row.feeKobo), lagosTime(row.issuedAt), row.state).joinToString("\n"))
            .setPositiveButton(R.string.reprint) { _, _ -> reprint(row.id) }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun reprint(ticketId: String) {
        if (busy) return
        busy = true
        binding.message.setText(R.string.reprinting)
        BackendClient.reprint(session, ticketId) { reply ->
            busy = false
            val ticket = if (reply.ok) reply.json()?.let(BackendClient::ticketOf) else null
            when {
                reply.status == 401 -> openSignIn(ended = true)
                reply.status == null -> binding.message.setText(R.string.cannot_reach)
                ticket != null && ticket.token.isNotBlank() -> {
                    TicketHolder.current = ticket
                    binding.message.text = ""
                    startActivity(Intent(this, TicketActivity::class.java))
                }
                reply.status == 404 -> binding.message.setText(R.string.not_found)
                reply.ok -> binding.message.text = SERVER_ERROR_MESSAGE.substringBefore(" No ticket")
                else -> binding.message.text = reply.message
            }
        }
    }

    companion object {
        private const val EXTRA_LIST = "ng.gsds.qrpark.LIST"
        private const val LIST_TODAY = "today"
        private const val LIST_LOOKUP = "lookup"

        fun today(context: Context) = Intent(context, TicketsActivity::class.java).putExtra(EXTRA_LIST, LIST_TODAY)
        fun lookup(context: Context) = Intent(context, TicketsActivity::class.java).putExtra(EXTRA_LIST, LIST_LOOKUP)
    }
}
