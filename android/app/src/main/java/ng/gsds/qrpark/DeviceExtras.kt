package ng.gsds.qrpark

import android.app.Activity
import android.content.Context
import android.content.Intent

/**
 * MINO-1: what a build flavour adds on a vendor's device, behind the
 * existing printer and scan seams. Each flavour has one object
 * `FlavourDevices` implementing this:
 *
 *  - src/standard: nothing - every answer is null, so every phone prints with
 *    Android printing and scans with CameraX, exactly as before;
 *  - a vendor flavour (MINO-1, src/<flavour>): that vendor's printer and
 *    scanner, but only once the device's own service has answered (found at
 *    run time, never from the model). See CLAUDE.md, Devices.
 *
 * The common code (this source set) holds only this interface and the rules
 * in DeviceRules.kt; no vendor class.
 */
interface DeviceExtras {
    /** Starts finding out whether this device's own printer and scanner answer. Cheap; safe to call often. */
    fun prepare(context: Context)

    /** The device's own ticket printer once it has answered; else null. */
    fun printer(activity: Activity): TicketPrinter?

    /** The screen that scans with the device's own scanner once it has answered; else null. */
    fun scanIntent(context: Context): Intent?
}

/**
 * The screen a Scan button opens: the device's own scanner where there is
 * one, else the camera (ScanActivity). Both hand their read over through
 * ScanHand, so the screen that asked handles it the same way.
 */
fun ticketScanIntent(context: Context): Intent {
    FlavourDevices.prepare(context.applicationContext)
    val vendor = FlavourDevices.scanIntent(context)
    return when (scanChoice(vendor != null)) {
        ScanChoice.VENDOR -> vendor!!
        ScanChoice.CAMERA -> Intent(context, ScanActivity::class.java)
    }
}
