package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/dispenser/app/src/test/java/ng/eparking/dispenser/ScanFillTest.kt; package changed only.

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.random.Random

/**
 * The gate's camera scan only FILLS the credential field, as a hardware
 * scanner would. It never submits and never opens the barrier: Check ticket
 * and Present at barrier stay separate taps.
 *
 * No token here is real - each is a made-up value of the same shape.
 */
class ScanFillTest {

    private val token = "Zq3x_7Lm2Pk9Rv4Wt8Yb1Nc6Hd0Gf5Js2Ka7Ue3Io9Op4As1"

    // ------------------------------------------------------- filling the field

    @Test
    fun `a scan puts the code in an empty field`() {
        assertEquals(token, fieldAfterScan(current = "", scanned = token))
    }

    @Test
    fun `a scan replaces what was there - never appends to it`() {
        // A half-typed code, or the last car's: either way the scan is the
        // credential now presented, and nothing of the old text survives.
        assertEquals(token, fieldAfterScan(current = "abc", scanned = token))
        assertEquals(token, fieldAfterScan(current = "another-whole-code", scanned = token))
    }

    @Test
    fun `surrounding whitespace and line ends are dropped`() {
        // A scanner that types a code commonly ends it with Enter.
        assertEquals(token, fieldAfterScan(current = "", scanned = "  $token\r\n"))
    }

    @Test
    fun `an empty or failed read leaves the field as it was`() {
        for (nothing in listOf(null, "", "   ", "\n")) {
            assertEquals("scanned=$nothing", "typed so far", fieldAfterScan("typed so far", nothing))
        }
    }

    // ------------------------------------------------------ reading the frame

    /** A camera-sized luminance frame with the app's own ticket QR drawn in it. */
    private fun frame(
        width: Int = 640,
        height: Int = 480,
        qrSize: Int = 300,
        dark: Int = 0,
        light: Int = 255,
        surround: Int = 255,
        noise: Int = 0,
        blur: Boolean = false,
    ): ByteArray {
        // Rendered exactly as QrRenderer renders a ticket: level M, margin 2.
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            EncodeHintType.MARGIN to 2,
            EncodeHintType.CHARACTER_SET to "UTF-8",
        )
        val matrix = QRCodeWriter().encode(token, BarcodeFormat.QR_CODE, qrSize, qrSize, hints)
        val left = (width - matrix.width) / 2
        val top = (height - matrix.height) / 2
        val random = Random(7)
        val pixels = IntArray(width * height) { i ->
            val x = i % width - left
            val y = i / width - top
            val base = when {
                x !in 0 until matrix.width || y !in 0 until matrix.height -> surround
                matrix[x, y] -> dark
                else -> light
            }
            (base + if (noise > 0) random.nextInt(-noise, noise + 1) else 0).coerceIn(0, 255)
        }
        val out = if (!blur) pixels else IntArray(pixels.size) { i ->
            // A 3x3 box blur: a little out of focus.
            val x = i % width
            val y = i / width
            var sum = 0
            var n = 0
            for (dy in -1..1) for (dx in -1..1) {
                val xx = x + dx
                val yy = y + dy
                if (xx in 0 until width && yy in 0 until height) {
                    sum += pixels[yy * width + xx]; n++
                }
            }
            sum / n
        }
        return ByteArray(out.size) { out[it].toByte() }
    }

    @Test
    fun `a clean ticket QR is read`() {
        assertEquals(token, QrDecoder.decodeLuminance(frame(), 640, 640, 480))
    }

    @Test
    fun `a QR photographed off another phone's screen is read`() {
        // A screen at normal brightness, photographed: black is not black and
        // white is not white, the sensor adds noise, focus is a little soft,
        // and the phone's own grey interface surrounds the 2-module margin.
        val photo = frame(qrSize = 220, dark = 60, light = 190, surround = 130, noise = 20, blur = true)
        assertEquals(token, QrDecoder.decodeLuminance(photo, 640, 640, 480))
    }

    @Test
    fun `a QR under uneven light - glare across the screen - is read`() {
        // A phone screen photographed at an angle to a light: one side washed
        // out, the other dim. A single global threshold cannot split that
        // frame; the local (hybrid) binarizer can.
        val width = 640
        val flat = frame(qrSize = 240, dark = 40, light = 200, surround = 120, noise = 8)
        val glare = ByteArray(flat.size) { i ->
            val x = i % width
            val gain = 0.35 + 1.3 * x / width   // 0.35 at the left edge, 1.65 at the right
            ((flat[i].toInt() and 0xFF) * gain).toInt().coerceIn(0, 255).toByte()
        }
        assertEquals(token, QrDecoder.decodeLuminance(glare, width, width, 480))
    }

    @Test
    fun `a frame with no QR in it reads as nothing`() {
        val empty = ByteArray(640 * 480) { (it % 251).toByte() }
        assertNull(QrDecoder.decodeLuminance(empty, 640, 640, 480))
    }

    @Test
    fun `the row stride is honoured, not assumed to be the width`() {
        // Camera frames are often padded: each row is longer than the image.
        val width = 640
        val stride = 704
        val tight = frame()
        val padded = ByteArray(stride * 480)
        for (y in 0 until 480) System.arraycopy(tight, y * width, padded, y * stride, width)
        assertEquals(token, QrDecoder.decodeLuminance(padded, stride, width, 480))
    }
}
