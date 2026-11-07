package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/dispenser/app/src/main/java/ng/eparking/dispenser/Hardware.kt
// (object QrDecoder only); the twin note removed.

import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/**
 * Reads a QR from one camera frame, for the gate's camera scan.
 *
 * Takes the Y plane of a YUV_420_888 frame directly - luminance is all a QR
 * decoder needs, so there is no colour conversion and no bitmap per frame.
 * TRY_HARDER and the HybridBinarizer are what read a QR photographed off
 * another phone's screen: lower contrast, sensor noise, soft focus and a grey
 * interface round a narrow margin (ScanFillTest).
 *
 * The decoded text is a credential. It is returned to the caller and to
 * nothing else - never logged.
 */
object QrDecoder {

    private val reader = QRCodeReader()
    private val hints = mapOf(DecodeHintType.TRY_HARDER to true)

    fun decodeLuminance(
        yPlane: ByteArray,
        rowStride: Int,
        width: Int,
        height: Int,
    ): String? = try {
        val source = PlanarYUVLuminanceSource(
            yPlane, rowStride, height, 0, 0, width, height, false,
        )
        reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
    } catch (_: Exception) {
        // No QR in this frame, or not a readable one. The next frame tries again.
        null
    } finally {
        reader.reset()
    }
}
