package ng.gsds.qrpark.nexgo

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.nexgo.oaf.apiv3.SdkResult
import com.nexgo.oaf.apiv3.device.scanner.OnScannerListener
import com.nexgo.oaf.apiv3.device.scanner.Scanner
import com.nexgo.oaf.apiv3.device.scanner.ScannerCfgEntity
import ng.gsds.qrpark.ScanActivity
import ng.gsds.qrpark.ScanHand
import ng.gsds.qrpark.VendorScanEnd
import ng.gsds.qrpark.VendorScanFlow
import ng.gsds.qrpark.VendorScanner

/**
 * The Nexgo scanner behind the app's VendorScanner seam: its own scan screen,
 * the back camera, one read, 60 seconds. On the main thread, as Nexgo's
 * sample does (init, then start when init succeeds).
 *
 * The read is handed to the caller and to nothing else: never logged, never
 * put in an Intent or an exception.
 *
 * Adapted from C:\Dev\qrpark-n86-probe ScanActivity.kt (nexgoScan, N86-1).
 */
class NexgoScanner(private val scanner: Scanner) : VendorScanner {

    private val main = Handler(Looper.getMainLooper())

    override fun scan(onEnd: (VendorScanEnd, String?) -> Unit) {
        val onRead = object : OnScannerListener {
            override fun onInitResult(retCode: Int) {}
            override fun onScannerResult(retCode: Int, data: String?) {
                main.post { onEnd(endOf(retCode), data) }
            }
        }
        val cfg = ScannerCfgEntity().apply {
            isAutoFocus = true
            isUsedFrontCcd = false
            isBulkMode = false
        }
        try {
            scanner.initScanner(cfg, object : OnScannerListener {
                override fun onInitResult(retCode: Int) {
                    main.post {
                        if (retCode != SdkResult.Success) {
                            onEnd(VendorScanEnd.FAILED, null)
                        } else if (scanner.startScan(TIMEOUT_SECONDS, onRead) != SdkResult.Success) {
                            onEnd(VendorScanEnd.FAILED, null)
                        }
                    }
                }

                override fun onScannerResult(retCode: Int, data: String?) {}
            })
        } catch (_: Throwable) {
            onEnd(VendorScanEnd.FAILED, null)
        }
    }

    override fun stop() {
        try {
            scanner.stopScan()
        } catch (_: Throwable) {
        }
    }

    private fun endOf(code: Int): VendorScanEnd = when (code) {
        SdkResult.Success -> VendorScanEnd.READ
        SdkResult.Scanner_Customer_Exit -> VendorScanEnd.USER_CLOSED
        SdkResult.TimeOut -> VendorScanEnd.TIMED_OUT
        else -> VendorScanEnd.FAILED
    }

    private companion object {
        const val TIMEOUT_SECONDS = 60
    }
}

/**
 * Opened by a Scan button on a Nexgo device (ticketScanIntent). It has no
 * screen of its own: the Nexgo scan screen shows on top. A read goes into
 * ScanHand - the same hand-over the camera uses - so Booth, Check and Exit
 * fill their field exactly as after a camera scan and act only on the
 * operator's tap. If the Nexgo scanner fails, the camera scan opens instead.
 */
class NexgoScanActivity : Activity() {

    private var scanner: NexgoScanner? = null
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) {
            // Recreated mid-scan: start over from the calling screen.
            finish()
            return
        }
        val sdkScanner = try {
            NexgoDevice.engine()?.scanner
        } catch (_: Throwable) {
            null
        }
        if (sdkScanner == null) {
            openCamera()
            finish()
            return
        }
        val s = NexgoScanner(sdkScanner).also { scanner = it }
        VendorScanFlow(
            scanner = s,
            hand = { ScanHand.put(it) },
            camera = { openCamera() },
            done = { finished = true; finish() },
        ).start()
    }

    private fun openCamera() = startActivity(Intent(this, ScanActivity::class.java))

    override fun onDestroy() {
        if (!finished) scanner?.stop()
        super.onDestroy()
    }
}
