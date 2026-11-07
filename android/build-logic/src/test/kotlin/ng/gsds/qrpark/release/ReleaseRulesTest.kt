package ng.gsds.qrpark.release

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Copied from eparking 359c0c1 android/build-logic/.../ReleaseRulesTest.kt and
// adapted: names, no flavours, the debug APK name and the previous-APK rule.
class ReleaseRulesTest {

    // ------------------------------------------------ the HTTPS guard

    @Test
    fun `an https address may go into a release build`() {
        assertNull(releaseAddressProblem("https://qrpark-test-api.onrender.com"))
        assertNull(releaseAddressProblem("https://api.example.ng:8443"))
    }

    @Test
    fun `a cleartext address is refused for release - including the emulator default`() {
        for (url in listOf(DEFAULT_API_BASE_URL, "http://qrpark-test-api.onrender.com", "HTTP://x.example")) {
            val problem = releaseAddressProblem(url)
            assertNotNull(url, problem)
            assertTrue("names the address: $problem", problem!!.contains(url))
            assertTrue("says what is required: $problem", problem.contains("https://"))
        }
    }

    @Test
    fun `anything that is not a plain https address is refused`() {
        for (url in listOf("", "   ", "https://", "https:// space.example", "ftp://x.example", "qrpark.example", "https://x.example/ ")) {
            assertNotNull("'$url'", releaseAddressProblem(url))
        }
    }

    // ------------------------------------------------ version numbering

    @Test
    fun `versionCode is the commit count, so it rises with every commit`() {
        assertEquals(437, versionCodeFor(437))
        assertTrue(versionCodeFor(438) > versionCodeFor(437))
    }

    @Test
    fun `versionName is readable and names the build and the commit`() {
        assertEquals("0.4.0-b437-1e1b858", versionNameFor("0.4.0", 437, "1e1b858", dirty = false))
        assertEquals("0.1.0-b438-1e1b858-dirty", versionNameFor("0.1.0", 437, "1e1b858", dirty = true))
    }

    @Test
    fun `a dirty build is higher than every build before it, and the next commit installs over it`() {
        assertEquals(438, versionCodeFor(437, dirty = true))
        assertTrue(versionCodeFor(437, dirty = true) > versionCodeFor(437))
        assertTrue(versionCodeFor(438) >= versionCodeFor(437, dirty = true))
    }

    @Test
    fun `a shallow clone or no git cannot number a release`() {
        assertNotNull(gitProblem(commitCount = 1, shallow = true))
        assertNotNull(gitProblem(commitCount = null, shallow = false))
        assertNotNull(gitProblem(commitCount = 0, shallow = false))
        assertNull(gitProblem(commitCount = 437, shallow = false))
    }

    // ------------------------------------------------ signing

    private val complete = mapOf(
        SigningKeys.STORE_FILE to "C:/keys/qrpark-test.jks",
        SigningKeys.STORE_PASSWORD to "x-store-pw",
        SigningKeys.KEY_ALIAS to "qrpark-test",
        SigningKeys.KEY_PASSWORD to "x-key-pw",
    )

    @Test
    fun `complete signing properties with an existing keystore are fine`() {
        assertEquals(emptyList<String>(), signingProblems(complete) { true })
    }

    @Test
    fun `each missing or blank property is named - and no value is ever printed`() {
        for (key in SigningKeys.ALL) {
            for (bad in listOf(null, "", "  ")) {
                val problems = signingProblems(complete + (key to bad)) { true }
                assertEquals("$key=$bad", 1, problems.size)
                assertTrue(problems[0], problems[0].contains(key))
            }
        }
        assertEquals(4, signingProblems(emptyMap()) { true }.size)
        val text = signingProblems(complete) { false }.joinToString()
        assertTrue("never a password: $text", !text.contains("-pw"))
    }

    @Test
    fun `a keystore path that does not exist is a problem, named by its property`() {
        val problems = signingProblems(complete) { false }
        assertEquals(1, problems.size)
        assertTrue(problems[0].contains(SigningKeys.STORE_FILE))
        assertTrue(problems[0].contains("C:/keys/qrpark-test.jks"))
    }

    // ------------------------------------------------ the APK

    @Test
    fun `the APK is named by version, build number, commit and kind`() {
        assertEquals(
            "qrpark-0.4.0-b6-bfb3724-debug.apk",
            apkFileName(versionNameFor("0.4.0", 6, "bfb3724", false), "debug"),
        )
        assertEquals(
            "qrpark-0.4.0-b7-bfb3724-dirty-debug.apk",
            apkFileName(versionNameFor("0.4.0", 6, "bfb3724", true), "debug"),
        )
    }

    @Test
    fun `a new debug APK deletes the previous debug APK and its sha256, nothing else`() {
        val keep = "qrpark-0.4.0-b7-abc1234-debug.apk"
        val folder = listOf(
            "qrpark-0.4.0-b6-0000000-debug.apk", "qrpark-0.4.0-b6-0000000-debug.apk.sha256",
            keep, "$keep.sha256",
            "qrpark-0.4.0-b6-0000000-release.apk", "qrpark-0.4.0-b6-0000000-release.apk.sha256",
            "notes.txt", "other-debug.apk",
        )
        assertEquals(
            listOf("qrpark-0.4.0-b6-0000000-debug.apk", "qrpark-0.4.0-b6-0000000-debug.apk.sha256"),
            previousApks(folder, "debug", keep),
        )
    }

    @Test
    fun `the release build meets the release check, the debug build does not`() {
        assertTrue(isReleasePreBuild("preReleaseBuild"))
        assertTrue(!isReleasePreBuild("preDebugBuild"))
    }

    @Test
    fun `the checksum line is what sha256sum -c reads`() {
        // sha256("abc")
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  x.apk\n",
            sha256Line("abc".toByteArray(), "x.apk"),
        )
    }
}
