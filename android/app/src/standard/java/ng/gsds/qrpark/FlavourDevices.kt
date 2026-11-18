package ng.gsds.qrpark

import android.app.Activity
import android.content.Context
import android.content.Intent

/**
 * The standard build (every phone): no device extras. Every phone prints
 * with Android printing and scans with CameraX, exactly as before MINO-1, and
 * the APK holds no vendor class (the APK guard checks it).
 */
object FlavourDevices : DeviceExtras {
    override fun prepare(context: Context) = Unit

    override fun printer(activity: Activity): TicketPrinter? = null

    override fun scanIntent(context: Context): Intent? = null
}
