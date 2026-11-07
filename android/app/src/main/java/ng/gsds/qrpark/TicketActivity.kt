package ng.gsds.qrpark

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import ng.gsds.qrpark.databinding.ActivityTicketBinding

/**
 * The ticket the backend returned: the header, the QR from the token, the
 * ticket's facts, Print and Check this ticket. The ticket comes from
 * TicketHolder (memory); after a restart there is none, and the screen says
 * to reprint it.
 */
class TicketActivity : AppCompatActivity() {

    private lateinit var binding: ActivityTicketBinding
    private var printing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityTicketBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.root.padForSystemBars()

        val ticket = TicketHolder.current
        if (ticket == null || !Session(this).isSignedIn) {
            showGone()
            return
        }
        val paper = ticketPaper(ticket)
        showHeader(paper.header)
        binding.qr.setImageBitmap(QrCodec.render(paper.qrToken, 720))
        binding.lines.typeface = Typeface.MONOSPACE
        binding.lines.text = paper.lines.dropLast(2).joinToString("\n") + "\n" + getString(R.string.ticket_footer)

        val printer = choosePrinter(this)
        binding.printButton.setOnClickListener {
            if (printing) return@setOnClickListener
            printing = true
            binding.printButton.isEnabled = false
            printer.print(paper) { outcome ->
                printing = false
                binding.printButton.isEnabled = true
                binding.message.text = printOutcomeText(outcome)
            }
        }
        binding.checkThisButton.setOnClickListener {
            startActivity(Intent(this, CheckActivity::class.java).putExtra(CheckActivity.EXTRA_SHOWN, true))
        }
        binding.doneButton.setOnClickListener { finish() }
    }

    /** Done or Back: the token leaves memory with the screen. */
    override fun onDestroy() {
        if (isFinishing) TicketHolder.current = null
        super.onDestroy()
    }

    private fun showGone() {
        binding.message.setText(R.string.ticket_gone)
        binding.printButton.isEnabled = false
        binding.checkThisButton.isEnabled = false
        binding.doneButton.setOnClickListener { finish() }
    }

    /** The two lines between the logos when they fit, otherwise beneath them (TicketHeader.kt). */
    private fun showHeader(text: HeaderText) {
        val brand = TextView(this).apply {
            setTypeface(typeface, Typeface.BOLD); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        }
        val contact = TextView(this).apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f) }
        val middle = (resources.displayMetrics.widthPixels * 0.45f)
        val full = (resources.displayMetrics.widthPixels * 0.8f)
        val plan = headerPlan(text, middle, full, { brand.paint.measureText(it) }, { contact.paint.measureText(it) })
        val target = if (plan.layout == HeaderLayout.INLINE) binding.headerInline else binding.headerStacked.also {
            it.visibility = android.view.View.VISIBLE
        }
        plan.brandLines.forEach { target.addView(line(it, 16f, bold = true)) }
        plan.contactLines.forEach { target.addView(line(it, 12f, bold = false)) }
    }

    private fun line(text: String, sp: Float, bold: Boolean) = TextView(this).apply {
        this.text = text
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }
}
