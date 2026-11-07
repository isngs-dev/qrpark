package ng.gsds.qrpark

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import ng.gsds.qrpark.databinding.ActivityScanBinding
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The scan handed from the camera screen to the booth: in memory only, never
 * in an Intent, a result or storage (SourceRulesTest). Taken once.
 */
object ScanHand {
    @Volatile
    private var scanned: String? = null

    fun put(text: String) {
        scanned = text
    }

    /** The scan, once; null when there is none. */
    fun take(): String? = scanned.also { scanned = null }

    fun clear() {
        scanned = null
    }
}

/** The camera, by what the device can do: never by its model (ScanFill.kt, ScannerKind). */
fun scannerKind(context: Context): ScannerKind =
    if (context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) ScannerKind.CAMERA else ScannerKind.NONE

/**
 * Scans a ticket's QR with the device camera and hands the text back to the
 * booth through [ScanHand]. A scan only fills the booth's field; the operator
 * taps Check. The text is never shown, logged or put in an Intent.
 *
 * Copied from eparking 359c0c1 android/pos/app/src/main/java/ng/eparking/pos/ScanActivity.kt
 * and adapted: the result goes to ScanHand and the screen closes (eparking
 * opened its visit screen with the token as an Intent extra, which this app
 * forbids); the manual-entry dialog is dropped (the booth's own field takes
 * typing); the decoder is QrDecoder.
 */
class ScanActivity : AppCompatActivity() {

    private lateinit var binding: ActivityScanBinding
    private lateinit var analysisExecutor: ExecutorService

    /** Latches on the first decode. A QR sits in frame for many frames. */
    private val handled = AtomicBoolean(false)

    private var cameraState = CameraState.NOT_STARTED
    private var cameraFailure = ""

    private val requestCamera =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                startCamera()
            } else {
                cameraState = CameraState.DENIED
                render(onResume(cameraState, permissionGranted = false, canAskAgain = canAskAgain()))
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityScanBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.scanOverlay.padForSystemBars()
        analysisExecutor = Executors.newSingleThreadExecutor()

        binding.closeButton.setOnClickListener { finish() }
        binding.cameraSettingsButton.setOnClickListener { openCameraSetting() }

        if (cameraPermitted()) startCamera() else requestCamera.launch(Manifest.permission.CAMERA)
    }

    override fun onResume() {
        super.onResume()
        val resumption = onResume(cameraState, cameraPermitted(), canAskAgain())
        render(resumption)
        if (resumption.startCamera) startCamera()
    }

    private fun render(resumption: Resumption) {
        binding.scanHint.text = when (resumption.hint) {
            ScanHint.POINT_AT_TICKET -> getString(R.string.point_at_ticket)
            ScanHint.CAMERA_DENIED -> getString(R.string.camera_denied)
            ScanHint.CAMERA_FAILED -> getString(R.string.camera_failed, cameraFailure)
        }
        binding.cameraSettingsButton.visibility = if (resumption.offerSettings) View.VISIBLE else View.GONE
    }

    private fun canAskAgain(): Boolean =
        ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.CAMERA)

    private fun openCameraSetting() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    private fun cameraPermitted(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun startCamera() {
        cameraState = CameraState.RUNNING
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(binding.preview.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { it.setAnalyzer(analysisExecutor, ::analyse) }
            try {
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                binding.scanHint.text = getString(R.string.point_at_ticket)
            } catch (e: Exception) {
                cameraState = CameraState.FAILED
                // The platform's own reason (no QR text is involved here).
                cameraFailure = e.javaClass.simpleName
                binding.scanHint.text = getString(R.string.camera_failed, cameraFailure)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun analyse(image: ImageProxy) {
        try {
            if (handled.get()) return
            val plane = image.planes.firstOrNull() ?: return
            val buffer = plane.buffer
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)
            val text = QrDecoder.decodeLuminance(bytes, plane.rowStride, image.width, image.height)
            if (text != null && handled.compareAndSet(false, true)) {
                runOnUiThread {
                    ScanHand.put(text)
                    setResult(Activity.RESULT_OK)
                    finish()
                }
            }
        } finally {
            image.close()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        analysisExecutor.shutdown()
    }
}
