package ng.gsds.qrpark.nexgo

import android.content.Context
import android.content.pm.PackageManager
import com.nexgo.oaf.apiv3.APIProxy
import com.nexgo.oaf.apiv3.DeviceEngine
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Whether this device's Nexgo printer and scanner answer - found at run time,
 * never from the model (CLAUDE.md, Devices; MINO-1).
 *
 * 1. Nexgo's system service must be installed. On any other phone it is not,
 *    and no Nexgo class is touched at all: the app behaves as the standard build.
 * 2. Then the SDK's engine (on the main thread, as Nexgo's sample does), and
 *    off it, the printer and the scanner must answer.
 *
 * Only the parts on the APK guard's allow-list are used: the engine, device
 * info (presence only), the printer and the camera scanner. No card, PIN,
 * EMV, key or system call (android/build-logic, GuardRules.kt).
 *
 * The approach comes from C:\Dev\qrpark-n86-probe Nexgo.kt (N86-1, which
 * printed and scanned on the Mino 1), narrowed to what the app needs.
 */
object NexgoDevice {

    /** Nexgo's system service: its presence is the first sign of a Nexgo device. */
    const val SERVICE_PACKAGE = "com.xgd.possystemservice"

    private enum class State { UNKNOWN, CHECKING, READY, ABSENT }

    @Volatile private var state = State.UNKNOWN
    @Volatile private var engine: DeviceEngine? = null
    @Volatile var printerReady = false
        private set
    @Volatile var scannerReady = false
        private set

    /** The one thread every printer call runs on, in order. */
    val sdkThread: ExecutorService = Executors.newSingleThreadExecutor()

    /** Called on the main thread. Idempotent: the first call decides, later ones return at once. */
    fun prepare(context: Context) {
        if (state != State.UNKNOWN) return
        state = State.CHECKING
        if (!serviceInstalled(context)) {
            state = State.ABSENT
            return
        }
        val e = try {
            APIProxy.getDeviceEngine(context.applicationContext)
        } catch (_: Throwable) {
            null
        }
        if (e == null) {
            state = State.ABSENT
            return
        }
        sdkThread.execute {
            val info = answers { e.deviceInfo != null }
            printerReady = info && answers { e.printer != null }
            scannerReady = info && answers { e.scanner != null }
            engine = e
            state = if (printerReady || scannerReady) State.READY else State.ABSENT
        }
    }

    /** The engine, once the device answered. */
    fun engine(): DeviceEngine? = if (state == State.READY) engine else null

    private fun answers(call: () -> Boolean): Boolean = try {
        call()
    } catch (_: Throwable) {
        // No reason is kept: an SDK exception's text is never shown or logged.
        false
    }

    private fun serviceInstalled(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(SERVICE_PACKAGE, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }
}
