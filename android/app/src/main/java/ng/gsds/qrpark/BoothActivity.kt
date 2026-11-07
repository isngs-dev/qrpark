package ng.gsds.qrpark

import android.app.Dialog
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import ng.gsds.qrpark.databinding.ActivityBoothBinding

/**
 * Booth mode (docs/01-flow.md section 2): scan (or Find by number), Check,
 * then "Paid" or "Take payment ₦N" -> Cash ("Confirm ₦N cash received", one
 * tap) or Card (Paystack's checkout in CheckoutSheet, inside the app; this
 * screen keeps polling behind it and waits for the backend's answer). Every decision about what is shown is in
 * BoothRules.kt; "Paid" only on the backend's word.
 *
 * Held in memory only, never stored or logged: the scanned text (cleared as
 * soon as it is sent), the checkout address, the payment being followed.
 * Stored (encrypted): the open payment attempt's key, by ticket id
 * (PaymentAttempts.kt).
 */
class BoothActivity : AppCompatActivity(), ScanScreen, ScanKeyScreen {

    private lateinit var binding: ActivityBoothBinding
    private lateinit var session: Session
    private lateinit var tap: PayTap
    override lateinit var scanKeys: ScannerKeys

    private val handler = Handler(Looper.getMainLooper())

    /** The ticket on screen (a summary: never a token). */
    private var ticket: BoothTicket? = null

    /** The card payment being followed, the checkout (memory only) and when the wait began (uptime). */
    private var cardPaymentId: String? = null
    private var checkoutUrl: String? = null
    private var waitStartedAt = 0L
    private var polling = false

    /** The checkout sheet, while it is open. It has no say over the payment (CheckoutSheet.kt). */
    private var sheet: Dialog? = null
    private var busy = false

    private val poll = Runnable { pollOnce() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityBoothBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.padForSystemBars()
        session = Session(this)
        if (!session.isSignedIn) return openSignIn(ended = false)
        if (!session.mode.opensBooth) return openHome(session)
        tap = PayTap(session.payments)
        scanKeys = ScannerKeys(this)

        binding.whoWhere.text = getString(R.string.signed_in_as, session.name, session.gateName)
        binding.site.text = session.siteName
        binding.scanField.enterNeverSubmits()
        binding.cameraButton.visibility = if (scannerKind(this) == ScannerKind.CAMERA) View.VISIBLE else View.GONE

        binding.checkButton.setOnClickListener { check() }
        binding.cameraButton.setOnClickListener { startActivity(Intent(this, ScanActivity::class.java)) }
        binding.findButton.setOnClickListener { askSuffix() }
        binding.takePaymentButton.setOnClickListener { showMethods() }
        binding.cashButton.setOnClickListener { showConfirmCash() }
        binding.takeCashButton.setOnClickListener { showConfirmCash() }
        binding.confirmCashButton.setOnClickListener { confirmCash() }
        binding.cardButton.setOnClickListener { startCard() }
        binding.tryCardAgainButton.setOnClickListener { startCard() }
        binding.openCheckoutButton.setOnClickListener { openCheckout() }
        binding.cancelPaymentButton.setOnClickListener { cancel(force = false) }
        binding.nextButton.setOnClickListener { next() }
        binding.signOutButton.setOnClickListener {
            stopPolling()
            closeSheet()
            BackendClient.logout(session) {}
            openSignIn(ended = false)
        }
        binding.scanField.requestFocus()
    }

    override fun onResume() {
        super.onResume()
        if (!::tap.isInitialized) return
        // A camera scan, handed over in memory: it only fills the field.
        ScanHand.take()?.let { deliverScan(scanTarget, it) }
        if (cardPaymentId != null && !polling) startPolling()
    }

    override fun onPause() {
        super.onPause()
        if (::scanKeys.isInitialized) scanKeys.stop()
    }

    override fun onDestroy() {
        stopPolling()
        closeSheet()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        (::scanKeys.isInitialized && scanKeys.dispatch(event)) || super.dispatchKeyEvent(event)

    // ------------------------------------------------------------ the scan field

    private val scanTarget = object : ScanTarget {
        override var text: String
            get() = binding.scanField.text?.toString().orEmpty()
            set(value) {
                binding.scanField.setText(value)
                binding.scanField.setSelection(value.length)
                binding.scanField.requestFocus()
            }

        /** A scan never calls it: the operator taps Check. */
        override fun submit() = check()
    }

    override fun scanField(): ScanTarget? = scanTarget.takeIf { binding.scanLayout.visibility == View.VISIBLE }

    // ------------------------------------------------------------ check and find

    private fun check() {
        if (busy || cardPaymentId != null) return
        val scanned = binding.scanField.text?.toString()?.trim().orEmpty()
        if (scanned.isEmpty()) return showTicket(null, BoothView.Problem(getString(R.string.nothing_to_check)))
        // The scanned text leaves the screen at once; only the backend's summary comes back.
        binding.scanField.text = null
        busy = true
        showTicket(null, BoothView.Problem(getString(R.string.checking)))
        BackendClient.check(session, scanned) { reply ->
            busy = false
            if (reply == CheckReply.SignInAgain) return@check openSignIn(ended = true)
            val view = boothViewOfCheck(reply)
            showTicket((reply as? CheckReply.Result)?.ticket, view)
        }
    }

    private fun askSuffix() {
        if (busy || cardPaymentId != null) return
        val field = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            hint = getString(R.string.last_characters)
            enterNeverSubmits()
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.find_by_number)
            .setView(field)
            .setPositiveButton(R.string.find) { _, _ -> find(field.text.toString().trim()) }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun find(suffix: String) {
        if (suffix.replace("-", "").length < 3) return showTicket(null, BoothView.Problem(getString(R.string.at_least_three)))
        busy = true
        BackendClient.lookup(session, suffix) { reply ->
            busy = false
            when {
                reply.status == 401 -> openSignIn(ended = true)
                reply.status == null -> showTicket(null, BoothView.Problem(getString(R.string.cannot_reach)))
                reply.status == 404 || reply.status == 400 -> showTicket(null, BoothView.Problem(getString(R.string.not_found)))
                !reply.ok -> showTicket(null, BoothView.Problem(reply.message))
                else -> {
                    val array = reply.array()
                    val found = (0 until (array?.length() ?: 0)).mapNotNull { i -> array!!.optJSONObject(i)?.let(BackendClient::summaryOf) }
                    if (found.isEmpty()) return@lookup showTicket(null, BoothView.Problem(getString(R.string.not_found)))
                    AlertDialog.Builder(this)
                        .setTitle(R.string.find_by_number)
                        .setItems(found.map { "${it.ticketNumber} · ${it.categoryName} · ${lagosTime(it.issuedAt)} · ${it.state}" }.toTypedArray()) { _, i ->
                            showTicket(found[i], boothView(found[i]))
                        }
                        .setNegativeButton(R.string.cancel, null)
                        .show()
                }
            }
        }
    }

    // ------------------------------------------------------------ what is shown

    private fun showTicket(t: BoothTicket?, view: BoothView) {
        ticket = t ?: (view as? BoothView.TakePayment)?.ticket ?: (view as? BoothView.Paid)?.ticket
        binding.resultCard.visibility = View.VISIBLE
        val shown = ticket
        binding.ticketLine.text = shown?.let { "${it.ticketNumber} · ${it.categoryName}" } ?: ""
        binding.ticketDetail.text = shown?.let { "${naira(it.feeKobo)} · ${lagosTime(it.issuedAt)}" } ?: ""
        resetActions()
        when (view) {
            is BoothView.Paid -> banner(view.line, R.color.good)
            is BoothView.TakePayment -> {
                banner(getString(R.string.unpaid), R.color.bad)
                binding.takePaymentButton.text = view.button
                binding.takePaymentButton.visibility = View.VISIBLE
            }
            is BoothView.AlreadyUsed -> banner(getString(R.string.already_used), R.color.bad)
            is BoothView.Expired -> banner(getString(R.string.expired), R.color.bad)
            BoothView.NotFound -> banner(getString(R.string.ticket_not_found), R.color.bad)
            BoothView.NotOurs -> banner(getString(R.string.not_ours), R.color.bad)
            is BoothView.Problem -> banner(view.message, R.color.muted)
        }
    }

    private fun banner(text: String, colour: Int) {
        binding.banner.text = text
        binding.banner.setBackgroundColor(ContextCompat.getColor(this, colour))
        binding.message.text = ""
    }

    private fun resetActions() {
        binding.takePaymentButton.visibility = View.GONE
        binding.methodRow.visibility = View.GONE
        binding.confirmCashButton.visibility = View.GONE
        binding.cardPanel.visibility = View.GONE
        binding.againRow.visibility = View.GONE
        binding.nextButton.visibility = View.VISIBLE
        binding.scanLayout.visibility = View.VISIBLE
    }

    private fun showMethods() {
        binding.takePaymentButton.visibility = View.GONE
        binding.methodRow.visibility = View.VISIBLE
    }

    private fun showConfirmCash() {
        val t = ticket ?: return
        binding.methodRow.visibility = View.GONE
        binding.againRow.visibility = View.GONE
        binding.confirmCashButton.text = BoothView.TakePayment(t).cashButton
        binding.confirmCashButton.visibility = View.VISIBLE
    }

    private fun next() {
        if (cardPaymentId != null) return
        ticket = null
        binding.resultCard.visibility = View.GONE
        binding.scanField.text = null
        binding.scanField.requestFocus()
    }

    // ------------------------------------------------------------ cash

    /** One tap is the confirmation. A double tap sends once (PayTap); a retry sends the same key. */
    private fun confirmCash() {
        val t = ticket ?: return
        val attempt = tap.tap(session.username, t.id, PayMethod.CASH) ?: return
        binding.confirmCashButton.isEnabled = false
        binding.message.setText(R.string.confirming_cash)
        BackendClient.cash(session, attempt) { reply, outcome ->
            tap.answered(attempt, outcome)
            binding.confirmCashButton.isEnabled = true
            if (reply == PayReply.SignInAgain) return@cash openSignIn(ended = true)
            if (reply is PayReply.Refused && reply.pendingPaymentId != null) return@cash follow(reply.pendingPaymentId, null, resumed = true)
            val view = cashView(reply)
            if (view is BoothView.Paid) {
                showTicket(view.ticket, view)
            } else {
                // Not paid: the button stays for a retry (same key), and the reason is said plainly.
                binding.message.text = (view as? BoothView.Problem)?.message ?: ""
            }
        }
    }

    // ------------------------------------------------------------ card

    private fun startCard() {
        val t = ticket ?: return
        val attempt = tap.tap(session.username, t.id, PayMethod.CARD) ?: return
        binding.methodRow.visibility = View.GONE
        binding.againRow.visibility = View.GONE
        binding.message.setText(R.string.starting_card)
        BackendClient.startCard(session, attempt) { reply, outcome ->
            tap.answered(attempt, outcome)
            when (reply) {
                PayReply.SignInAgain -> openSignIn(ended = true)
                is PayReply.Ok -> {
                    val id = reply.paymentId
                    if (id == null) {
                        binding.message.text = SERVER_ERROR_MESSAGE.substringBefore(" No ticket")
                    } else {
                        follow(id, reply.checkoutUrl, resumed = false)
                    }
                }
                is PayReply.Refused ->
                    if (reply.pendingPaymentId != null) follow(reply.pendingPaymentId, null, resumed = true)
                    else showAgain(reply.message)
                PayReply.NoConnection -> showAgain(PAY_NO_CONNECTION.replace("the cash is not taken twice", "no second payment is started"))
                PayReply.ServerError -> showAgain(PAY_SERVER_ERROR.replace("the cash is not taken twice", "no second payment is started"))
            }
        }
    }

    /** Follow one card payment until the backend says how it ended. */
    private fun follow(paymentId: String, url: String?, resumed: Boolean) {
        cardPaymentId = paymentId
        checkoutUrl = checkoutToOpen(url)
        waitStartedAt = SystemClock.elapsedRealtime()
        binding.scanLayout.visibility = View.GONE
        binding.takePaymentButton.visibility = View.GONE
        binding.methodRow.visibility = View.GONE
        binding.confirmCashButton.visibility = View.GONE
        binding.againRow.visibility = View.GONE
        binding.nextButton.visibility = View.GONE
        binding.cardPanel.visibility = View.VISIBLE
        binding.cancelPaymentButton.visibility = View.GONE
        binding.openCheckoutButton.visibility = if (checkoutUrl != null) View.VISIBLE else View.GONE
        binding.waitingText.text = CardView.Waiting(false, false).text
        binding.message.text = if (resumed) getString(R.string.resuming_card) else ""
        if (!resumed) openCheckout()
        startPolling()
    }

    /**
     * Paystack's checkout, inside the app (CheckoutSheet). Only an address that
     * passes checkoutToOpen() is opened; the sheet checks it again. The booth
     * keeps polling behind the sheet; the sheet decides nothing.
     */
    private fun openCheckout() {
        val url = checkoutToOpen(checkoutUrl) ?: return run { binding.message.setText(R.string.checkout_not_opened) }
        if (sheet?.isShowing == true) return
        sheet = CheckoutSheet.open(this, url) { sheet = null }
    }

    /** The payment reached a resting state (or the screen is going): the sheet goes. */
    private fun closeSheet() {
        sheet?.dismiss()
        sheet = null
    }

    private fun startPolling() {
        polling = true
        handler.removeCallbacks(poll)
        handler.post(poll)
    }

    private fun stopPolling() {
        polling = false
        handler.removeCallbacks(poll)
    }

    private fun pollOnce() {
        val id = cardPaymentId ?: return stopPolling()
        BackendClient.payment(session, id) { reply ->
            if (cardPaymentId != id || !polling) return@payment
            val view = cardView(reply, SystemClock.elapsedRealtime() - waitStartedAt)
            if (reply is PollReply.NotFound) {
                endCard(getString(R.string.card_elsewhere), offerAgain = false)
                return@payment
            }
            when (view) {
                is CardView.Waiting -> {
                    binding.waitingText.text = view.text
                    binding.cancelPaymentButton.visibility = if (view.cancelOffered) View.VISIBLE else View.GONE
                    // A poll answered: an earlier "cannot reach" no longer stands.
                    if (binding.message.text.toString() == POLL_NO_CONNECTION || binding.message.text.toString() == POLL_SERVER_ERROR) {
                        binding.message.text = ""
                    }
                }
                is CardView.Paid -> {
                    stopPolling()
                    closeSheet()
                    cardPaymentId = null
                    showTicket(view.ticket, BoothView.Paid(view.ticket))
                }
                is CardView.Ended -> endCard(view.message, offerAgain = true)
                is CardView.Problem -> binding.message.text = view.message
            }
            if (keepsPolling(view) && polling) handler.postDelayed(poll, POLL_EVERY_MS)
        }
    }

    private fun endCard(message: String, offerAgain: Boolean) {
        stopPolling()
        closeSheet()
        cardPaymentId = null
        checkoutUrl = null
        binding.cardPanel.visibility = View.GONE
        binding.scanLayout.visibility = View.VISIBLE
        binding.nextButton.visibility = View.VISIBLE
        if (offerAgain) showAgain(message) else binding.message.text = message
    }

    /** After a card payment ended without paying: Try card again (a NEW attempt) or Take cash. */
    private fun showAgain(message: String) {
        binding.message.text = message
        binding.againRow.visibility = if (ticket != null) View.VISIBLE else View.GONE
    }

    // ------------------------------------------------------------ cancel

    private fun cancel(force: Boolean) {
        val id = cardPaymentId ?: return
        if (busy) return
        busy = true
        binding.cancelPaymentButton.isEnabled = false
        binding.message.setText(R.string.cancelling)
        BackendClient.cancelPayment(session, id, force) { reply ->
            busy = false
            binding.cancelPaymentButton.isEnabled = true
            when (val view = cancelView(reply)) {
                is CancelView.Ended -> endCard(view.message, offerAgain = true)
                is CancelView.Paid -> {
                    stopPolling()
                    closeSheet()
                    cardPaymentId = null
                    showTicket(view.ticket, BoothView.Paid(view.ticket))
                }
                is CancelView.StillWaiting -> binding.message.text = view.message
                is CancelView.ConfirmForce -> {
                    binding.message.text = view.warning
                    AlertDialog.Builder(this)
                        .setTitle(R.string.cannot_confirm_title)
                        .setMessage(view.warning)
                        .setPositiveButton(R.string.cancel_anyway) { _, _ -> cancel(force = true) }
                        .setNegativeButton(R.string.keep_waiting, null)
                        .show()
                }
            }
        }
    }
}
