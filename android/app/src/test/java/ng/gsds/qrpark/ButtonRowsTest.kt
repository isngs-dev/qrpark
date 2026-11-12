package ng.gsds.qrpark

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * UI-1 (A1): buttons side by side are always the same height and width, and
 * never clipped.
 *
 * The cause, as seen on the Booth: a horizontal LinearLayout aligns its
 * children by their text BASELINE unless told not to. When one label wraps to
 * two lines ("Scan with camera" at a large font), its first baseline is lined
 * up with the other button's only one, so it is pushed down and its bottom is
 * cut off by the row; and with wrap_content the two are different heights.
 *
 * So, in every layout, a row of two or more buttons:
 * - has android:baselineAligned="false";
 * - gives each button the full row height (match_parent) and an equal share of
 *   the width (0dp, weight 1);
 * - holds only short labels. A pair whose labels are long ("Try card again" /
 *   "Take cash") is stacked full width instead.
 *
 * The checkout sheet's bar (a title and one Close button) and Android's own
 * dialogs (which stack their buttons when they do not fit) have no pair.
 */
class ButtonRowsTest {

    private val strings: Map<String, String> =
        Regex("""<string name="(\w+)">([^<]*)</string>""").findAll(File("src/main/res/values/strings.xml").readText())
            .associate { it.groupValues[1] to it.groupValues[2] }

    private fun layouts() = File("src/main/res/layout").listFiles()!!.filter { it.extension == "xml" }.sortedBy { it.name }

    /** Every <LinearLayout ...> start tag with its children's start tags up to its own end, as text. */
    private fun rows(xml: String): List<Pair<String, List<String>>> {
        val clean = xml.replace(Regex("""<!--[\s\S]*?-->"""), "")
        val out = mutableListOf<Pair<String, List<String>>>()
        for (m in Regex("""<LinearLayout\b[^>]*>""").findAll(clean)) {
            if (!m.value.contains("android:orientation=\"horizontal\"")) continue
            // Its direct body: up to the matching </LinearLayout>.
            var depth = 1
            var i = m.range.last + 1
            val tag = Regex("""<(/?)LinearLayout\b[^>]*?(/?)>""")
            var end = clean.length
            while (depth > 0) {
                val t = tag.find(clean, i) ?: break
                if (t.groupValues[1] == "/") depth-- else if (t.groupValues[2] != "/") depth++
                i = t.range.last + 1
                if (depth == 0) end = t.range.first
            }
            val body = clean.substring(m.range.last + 1, end)
            val buttons = Regex("""<com\.google\.android\.material\.button\.MaterialButton\b[^>]*/>|<Button\b[^>]*/>""").findAll(body).map { it.value }.toList()
            out += m.value to buttons
        }
        return out
    }

    private fun label(button: String): String {
        val ref = Regex("""android:text="@string/(\w+)"""").find(button)?.groupValues?.get(1)
        return ref?.let { strings[it] } ?: ""
    }

    @Test
    fun `the scan sees the button rows`() {
        val paired = layouts().flatMap { f -> rows(f.readText()).filter { it.second.size >= 2 }.map { f.name } }
        // Booth: camera/find and cash/card; Exit: camera/check. Check (UI-1 A2) stacks its camera
        // button over Check, whose label grows to "Check this ticket · <number>".
        assertEquals(listOf("activity_booth.xml", "activity_booth.xml", "activity_exit.xml"), paired)
    }

    @Test
    fun `every row of buttons is unaligned by baseline, full height and equal width`() {
        for (f in layouts()) {
            for ((row, buttons) in rows(f.readText())) {
                if (buttons.size < 2) continue
                assertTrue("${f.name}: $row", row.contains("android:baselineAligned=\"false\""))
                for (b in buttons) {
                    assertTrue("${f.name}: $b", b.contains("android:layout_height=\"match_parent\""))
                    assertTrue("${f.name}: $b", b.contains("android:layout_width=\"0dp\""))
                    assertTrue("${f.name}: $b", b.contains("android:layout_weight=\"1\""))
                }
            }
        }
    }

    @Test
    fun `a pair side by side has short labels - long ones are stacked`() {
        for (f in layouts()) {
            for ((_, buttons) in rows(f.readText())) {
                if (buttons.size < 2) continue
                for (b in buttons) {
                    val text = label(b)
                    assertTrue("${f.name}: a button in a row needs a fixed label", text.isNotEmpty())
                    assertTrue("${f.name}: \"$text\" is too long to sit beside another button", text.length <= MAX_PAIRED_LABEL)
                }
            }
        }
    }

    @Test
    fun `Try card again and Take cash are stacked full width`() {
        val booth = File("src/main/res/layout/activity_booth.xml").readText()
        val again = Regex("""<LinearLayout\b[^>]*android:id="@\+id/againRow"[^>]*>""").find(booth)?.value.orEmpty()
        assertTrue(again, again.contains("android:orientation=\"vertical\""))
        for (id in listOf("tryCardAgainButton", "takeCashButton")) {
            val b = Regex("""<com\.google\.android\.material\.button\.MaterialButton\b[^>]*android:id="@\+id/$id"[^>]*/>""").find(booth)?.value.orEmpty()
            assertTrue(b, b.contains("android:layout_width=\"match_parent\""))
        }
    }

    companion object {
        /**
         * The longest label that sits beside another button: "Scan with
         * camera". At font scale 1.3 on a 360dp screen it takes two lines,
         * which the full-height rows above keep even.
         */
        const val MAX_PAIRED_LABEL = 16
    }
}

/**
 * UI-1 (A3): the launcher icon is eparking's GSD chevron (copied, not linked)
 * and the label stays "QR Parking", so the two apps are never confused on
 * one device.
 */
class LauncherIconTest {

    @Test
    fun `the icon is set, adaptive, and the label is QR Parking`() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:icon=\"@mipmap/ic_launcher\""))
        assertTrue(manifest.contains("android:roundIcon=\"@mipmap/ic_launcher_round\""))
        assertTrue(manifest.contains("android:label=\"@string/app_name\""))
        assertTrue(File("src/main/res/values/strings.xml").readText().contains("<string name=\"app_name\">QR Parking</string>"))
        for (name in listOf("ic_launcher", "ic_launcher_round")) {
            val icon = File("src/main/res/mipmap-anydpi-v26/$name.xml").readText()
            assertTrue(name, icon.contains("<adaptive-icon") && icon.contains("@mipmap/ic_launcher_foreground"))
        }
        for (d in listOf("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")) {
            assertTrue(d, File("src/main/res/mipmap-$d/ic_launcher_foreground.png").isFile)
        }
    }
}
