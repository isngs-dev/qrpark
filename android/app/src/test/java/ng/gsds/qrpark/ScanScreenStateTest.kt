package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/pos/app/src/test/java/ng/eparking/pos/ScanScreenStateTest.kt; package changed only.

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A screen must not tell an operator to point a camera that is not running.
 *
 * Reproduced on the counter device, all three ways:
 *
 *  1. THE FIRST DENIAL IS NEVER SEEN. The system's permission dialog pauses
 *     this activity, so onResume runs AFTER the denial callback. Tapped
 *     "Don't allow" (granted=false confirmed), dismissed the manual-entry
 *     dialog, and the screen read:
 *
 *       "Point the camera at the ticket QR"
 *
 *     The denial message existed for a few frames behind a modal.
 *
 *  2. WHEN IT IS SEEN, IT IS LOST. With the permission already fixed at
 *     denied the callback lands first, so the hint is right - until the
 *     operator goes anywhere:
 *
 *       before HOME: "Camera not permitted. Type the ticket in instead."
 *       after return: "Point the camera at the ticket QR"
 *
 *     over a completely black screen.
 *
 *  3. AND GRANTING IT DOES NOT HELP. Backgrounded, granted the permission -
 *     the operator going to Settings and doing exactly the right thing - and
 *     returned. The screenshot was byte-identical to the denied one
 *     (md5 4c3e87a3f6568ad618ff635b25440660), still black, still saying
 *     "Point the camera at the ticket QR", with no way out but killing the
 *     app. startCamera is reachable only from onCreate and the permission
 *     callback, so a resume can never start a camera it refused earlier.
 *
 * This is why "stop onResume touching the hint" is not the fix. The hint is
 * a symptom: onResume assumes resumed means live, and that assumption is
 * false in three of the four states this screen can be in. The hint has to
 * follow the camera, and the resume has to be able to start it.
 *
 * NOT the shape of the settings-label bug (see SettingsMessage in the
 * dispenser). That was two subjects - backend health and a settings save -
 * contending for one view, and was fixed by giving one its own view. Here
 * all three writers describe the same subject, the camera. There is nothing
 * to arbitrate; there is one thing to derive.
 */
class ScanScreenStateTest {

    // --------------------------------------------- the camera is running fine

    @Test
    fun `a running camera is told to scan the next customer`() {
        // The ordinary case: back from the visit screen, next ticket please.
        val after = onResume(CameraState.RUNNING, permissionGranted = true)
        assertEquals(ScanHint.POINT_AT_TICKET, after.hint)
        assertFalse("already bound - rebinding would flicker the preview", after.startCamera)
    }

    // ------------------------------------------ refused, and still refused

    @Test
    fun `a denied camera keeps saying so`() {
        // THE bug. The hint is the only thing on a black screen, and it
        // currently contradicts it.
        val after = onResume(CameraState.DENIED, permissionGranted = false)
        assertEquals(ScanHint.CAMERA_DENIED, after.hint)
    }

    @Test
    fun `a denied camera is not started`() {
        assertFalse(onResume(CameraState.DENIED, permissionGranted = false).startCamera)
    }

    @Test
    fun `a denial survives any number of returns to the screen`() {
        // Case 2, stated as the loop it is: nothing about resuming makes a
        // refused permission any less refused.
        var state = CameraState.DENIED
        repeat(5) {
            val after = onResume(state, permissionGranted = false)
            assertEquals(ScanHint.CAMERA_DENIED, after.hint)
            state = CameraState.DENIED
        }
    }

    // ------------------------------------- refused, then granted in Settings

    @Test
    fun `granting the permission while away starts the camera on return`() {
        // Case 3, the half that was not recorded. The operator went to
        // Settings and fixed it; the screen must notice.
        val after = onResume(CameraState.DENIED, permissionGranted = true)
        assertTrue(after.startCamera)
        assertEquals(ScanHint.POINT_AT_TICKET, after.hint)
    }

    @Test
    fun `a screen that has never started its camera starts it`() {
        val after = onResume(CameraState.NOT_STARTED, permissionGranted = true)
        assertTrue(after.startCamera)
        assertEquals(ScanHint.POINT_AT_TICKET, after.hint)
    }

    @Test
    fun `a camera that cannot be permitted is never started`() {
        // Stated across every state: permission is the gate, not the state.
        CameraState.entries.forEach { state ->
            assertFalse(
                "$state must not start a camera without permission",
                onResume(state, permissionGranted = false).startCamera,
            )
        }
    }

    // ----------------------------------------------- the bind itself failed

    @Test
    fun `a failed bind is retried on the next resume`() {
        // A resume is a natural retry point - the camera may have been held
        // by another app and freed since. The alternative is a screen that
        // stays dead after one failure, which is a bug this project has
        // already fixed once on the entry screen.
        assertTrue(onResume(CameraState.FAILED, permissionGranted = true).startCamera)
    }

    @Test
    fun `a failed bind keeps its message until the retry says otherwise`() {
        // It must not be papered over with "point the camera" while the
        // retry is still in flight.
        assertEquals(
            ScanHint.CAMERA_FAILED,
            onResume(CameraState.FAILED, permissionGranted = true).hint,
        )
    }

    @Test
    fun `a failed bind with the permission since revoked reads as denied`() {
        // Defensive: permission is checked first, so the message names the
        // thing the operator can actually act on.
        val after = onResume(CameraState.FAILED, permissionGranted = false)
        assertEquals(ScanHint.CAMERA_DENIED, after.hint)
        assertFalse(after.startCamera)
    }

    // ------------------------------------------------ nothing says point at
    // a camera that is not going to run

    @Test
    fun `point at the ticket is only ever said of a live or starting camera`() {
        // The whole bug in one sentence, stated so a state added later has
        // to be considered rather than inheriting permission to lie.
        val states = CameraState.entries.flatMap { listOf(it to true, it to false) }
        states.forEach { (state, granted) ->
            val after = onResume(state, granted)
            if (after.hint == ScanHint.POINT_AT_TICKET) {
                assertTrue(
                    "$state/granted=$granted says point at a camera that is neither running nor starting",
                    after.startCamera || (state == CameraState.RUNNING && granted),
                )
            }
        }
    }

    // ------------------ the way back, once the permission is fixed at denied

    /*
     * M22: A DEAD END NOBODY IS TOLD HOW TO LEAVE.
     *
     * With the system's "don't ask again" flag set, the request returns a
     * refusal without showing its dialog. Reproduced on the counter device:
     * denied with "Don't allow", which set USER_FIXED in one tap, leaving the
     * screen holding a black preview, "Type it in", and
     *
     *   "Camera not permitted. Type the ticket in instead."
     *
     * All true, and a dead end. Backing out to the menu and re-entering the
     * scan screen re-launches the request, and the system prompt does NOT come
     * back - confirmed live, the screen goes straight to the manual-entry box.
     * The only route to a working scanner is the Android settings app, and
     * nothing tells the operator that.
     *
     * THE TWO DENIED STATES ARE NOT THE SAME, which is the whole of this rule,
     * and it was checked rather than assumed by clearing the flag:
     *
     *   USER_SET | USER_FIXED   re-entering shows no dialog     -> dead end
     *   USER_SET only           re-entering shows the dialog    -> a way back
     *
     * So offering Settings in the second case would not just be redundant, it
     * would be WORSE: it sends an operator into the Android settings app when
     * one tap on a dialog this app can still raise would do it.
     *
     * shouldShowRequestPermissionRationale IS OVERLOADED, and that is the trap
     * this rule exists to survive. It returns false for permanently-denied AND
     * for never-asked. Read on its own it would put a Settings button in front
     * of a fresh install that has not been asked yet. CameraState.DENIED is
     * what makes it safe: it means "we asked and were refused", so the
     * never-asked case cannot reach the check at all.
     */

    @Test
    fun `a permanently denied camera is offered the way to Settings`() {
        // The one M22 is about. Asked, refused, and the system will not ask
        // again - so the app has to say where the switch is.
        val after = onResume(CameraState.DENIED, permissionGranted = false, canAskAgain = false)
        assertTrue("there is no other route back to a working scanner", after.offerSettings)
        assertEquals(ScanHint.CAMERA_DENIED, after.hint)
    }

    @Test
    fun `a camera that can still be asked for is not sent to Settings`() {
        // Backing out and coming in again raises the system dialog, which is
        // one tap. Settings would be four, in another app.
        val after = onResume(CameraState.DENIED, permissionGranted = false, canAskAgain = true)
        assertFalse("the app can still ask; sending them to Settings is worse", after.offerSettings)
    }

    @Test
    fun `a screen that has never asked does not offer Settings`() {
        // THE TRAP. shouldShowRequestPermissionRationale is false here too,
        // because nothing has been asked yet - so the rationale flag alone
        // would put a Settings button on a fresh install.
        val after = onResume(CameraState.NOT_STARTED, permissionGranted = false, canAskAgain = false)
        assertFalse("nobody has been asked anything yet", after.offerSettings)
    }

    @Test
    fun `granting the permission takes the button away again`() {
        // The operator went to Settings, allowed it, and came back. The state
        // is still DENIED - that is what M5's resume is for - and the rationale
        // flag reads false for a GRANTED permission too, so without the
        // permission check the button would survive its own success.
        val after = onResume(CameraState.DENIED, permissionGranted = true, canAskAgain = false)
        assertFalse("the permission is granted; there is nothing to go and fix", after.offerSettings)
        assertTrue("and M5's restart still has to happen", after.startCamera)
    }

    @Test
    fun `a camera that failed to bind is not a permission problem`() {
        // FAILED means the permission was there and binding threw - another
        // app holding the camera, a driver fault. Settings has nothing to
        // offer, and saying so would send the operator on a pointless errand.
        assertFalse(
            onResume(CameraState.FAILED, permissionGranted = true, canAskAgain = false).offerSettings,
        )
    }

    @Test
    fun `nothing offers Settings while the camera can work`() {
        // Stated as a whole, so a state added later has to be considered
        // rather than inheriting permission to show the button.
        CameraState.values().forEach { state ->
            assertFalse(
                "$state with the permission granted",
                onResume(state, permissionGranted = true, canAskAgain = false).offerSettings,
            )
        }
    }
}
