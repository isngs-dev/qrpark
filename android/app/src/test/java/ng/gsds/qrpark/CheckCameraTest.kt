package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * UI-1 (A2): Entry's Check scans with the camera, as Booth and Exit do
 * (docs/01-flow.md section 4: all three jobs scan or type). The same pieces:
 * ScanActivity hands the scan over in memory (ScanHand), deliverScan only
 * FILLS the field, and Check stays the operator's tap.
 */
class CheckCameraTest {

    private val layout = File("src/main/res/layout/activity_check.xml").readText().replace(Regex("""<!--[\s\S]*?-->"""), "")
    private val check = stripComments(File("src/main/java/ng/gsds/qrpark/CheckActivity.kt").readText())

    @Test
    fun `the Check screen has a Scan with camera button`() {
        val button = Regex("""<com\.google\.android\.material\.button\.MaterialButton\b[^>]*android:id="@\+id/cameraButton"[^>]*/>""").find(layout)?.value.orEmpty()
        assertTrue("activity_check.xml: no cameraButton", button.isNotEmpty())
        assertTrue(button, button.contains("android:text=\"@string/scan_with_camera\""))
    }

    @Test
    fun `it shows only when the device has a camera, and opens ScanActivity`() {
        assertTrue(check.contains("binding.cameraButton.visibility = if (scannerKind(this) == ScannerKind.CAMERA) View.VISIBLE else View.GONE"))
        assertTrue(check.contains("binding.cameraButton.setOnClickListener { startActivity(Intent(this, ScanActivity::class.java)) }"))
    }

    @Test
    fun `the scan comes back in memory and only fills the field - Check stays a tap`() {
        val onResume = Regex("""override fun onResume\(\)[\s\S]*?\n    }""").find(check)?.value.orEmpty()
        assertTrue("onResume takes the scan from ScanHand", onResume.contains("ScanHand.take()?.let { deliverScan(scanTarget, it) }"))
        assertFalse("no scan read from an Intent", Regex("""getStringExtra|getExtras|\.data\b|getParcelable""").containsMatchIn(check))
        assertFalse("nothing scanned put in an Intent", Regex("""putExtra\s*\([^)]*(?i:scan|token|code)""").containsMatchIn(check))
        // The target's setter fills and focuses; its submit is the Check tap, which a scan never calls.
        val target = Regex("""private val scanTarget = object : ScanTarget \{[\s\S]*?\n    }""").find(check)?.value.orEmpty()
        assertTrue(target, target.contains("binding.scanField.setText(value)"))
        assertFalse("the setter checks nothing", Regex("""set\(value\)[\s\S]*?check\(""").containsMatchIn(target.substringBefore("override fun submit")))
        assertEquals(1, Regex("""deliverScan\(""").findAll(check).count())
    }

    @Test
    fun `checking the ticket on screen has no scan field, so no camera either`() {
        val shown = Regex("""if \(intent\.getBooleanExtra\(EXTRA_SHOWN, false\) && onScreen != null\) \{[\s\S]*?\n        }""").find(check)?.value.orEmpty()
        assertTrue(shown, shown.contains("binding.cameraButton.visibility = View.GONE"))
    }
}
