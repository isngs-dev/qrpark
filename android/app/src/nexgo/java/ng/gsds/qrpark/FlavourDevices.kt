package ng.gsds.qrpark

import android.app.Activity
import android.content.Context
import android.content.Intent
import ng.gsds.qrpark.nexgo.NexgoDevice
import ng.gsds.qrpark.nexgo.NexgoScanActivity
import ng.gsds.qrpark.nexgo.NexgoTicketPrinter

/**
 * The nexgo build: the Nexgo printer and scanner, but only once this
 * device's Nexgo service has answered (NexgoDevice). Until then, and on any
 * other phone, every answer is null and the app behaves as the standard
 * build: Android printing and CameraX.
 */
object FlavourDevices : DeviceExtras {
    override fun prepare(context: Context) = NexgoDevice.prepare(context)

    override fun printer(activity: Activity): TicketPrinter? =
        if (NexgoDevice.printerReady && NexgoDevice.engine() != null) NexgoTicketPrinter(activity) else null

    override fun scanIntent(context: Context): Intent? =
        if (NexgoDevice.scannerReady && NexgoDevice.engine() != null) Intent(context, NexgoScanActivity::class.java) else null
}
