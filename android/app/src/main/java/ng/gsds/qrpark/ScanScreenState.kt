package ng.gsds.qrpark

// Copied from eparking 359c0c1 android/pos/app/src/main/java/ng/eparking/pos/ScanScreenState.kt; package changed only.

/**
 * What the scan screen should do each time it comes back to the front.
 *
 * The screen resumed assuming the camera was live and said so unconditionally,
 * which is true in one of the four states it can be in. Demonstrated three
 * ways on the counter device - see ScanScreenStateTest - the worst being an
 * operator who went to Settings, allowed the camera, came back, and got the
 * same black screen, because a resume could not start a camera that an earlier
 * refusal had left unbound.
 *
 * So the hint is DERIVED here rather than written from whatever the last
 * handler assumed. It cannot say "point the camera" at a camera that is not
 * running or about to be.
 */

/** Where the camera has got to. */
enum class CameraState {
    /** Nothing has been bound yet. */
    NOT_STARTED,

    /** Bound to the lifecycle, or binding right now. */
    RUNNING,

    /** The operator refused the permission. */
    DENIED,

    /** The permission was there, but binding threw. */
    FAILED,
}

/** The line along the bottom of the scan screen. */
enum class ScanHint {
    POINT_AT_TICKET,
    CAMERA_DENIED,
    CAMERA_FAILED,
}

/** What a resume should do. */
data class Resumption(
    /** Bind the camera - it is not running and could be. */
    val startCamera: Boolean,
    /** What the screen should say. */
    val hint: ScanHint,
    /** Show the way to the Android settings page for this app. */
    val offerSettings: Boolean = false,
)

/**
 * Decide what a resume does, from the state the camera is actually in.
 *
 * Permission is asked first, so the message always names the thing the
 * operator can act on. Note what is deliberately absent: nothing here asks
 * for the permission again. With the system's "don't ask again" flag set the
 * request returns a refusal instantly, and re-launching it on every resume
 * would put the manual-entry dialog in front of the operator every time they
 * came back to this screen. Type it in is one way through, and for a
 * permission fixed at denied [offerSettings] is the other - see below for why
 * that is only the FIXED case.
 */
fun onResume(
    state: CameraState,
    permissionGranted: Boolean,
    /**
     * May the app still raise the system's own permission dialog?
     *
     * This is `shouldShowRequestPermissionRationale`, and it is OVERLOADED: it
     * reads false for a permission fixed at denied, false when nothing has
     * been asked yet, and false for one already granted. On its own it decides
     * nothing, which is why [offerSettings] below pairs it with two other
     * facts rather than trusting it.
     *
     * Defaults to "the app can still ask", the answer that never offers
     * Settings, so a call site that forgets it fails safe.
     */
    canAskAgain: Boolean = true,
): Resumption {
    // No permission, no camera - whatever the screen was doing before.
    if (!permissionGranted) {
        return Resumption(
            startCamera = false,
            hint = ScanHint.CAMERA_DENIED,
            // THE DEAD END, AND ONLY THE DEAD END. Three facts, and each one
            // is carrying weight:
            //
            //  - not granted, or there is nothing to go and fix. After the
            //    operator allows it in Settings and comes back the state is
            //    STILL DENIED, which is what this whole function exists for,
            //    and canAskAgain reads false for a granted permission - so
            //    without this the button would survive its own success.
            //  - DENIED, meaning asked and refused. Nothing has been asked on
            //    a fresh install either, and canAskAgain reads false there
            //    too; this is what keeps a Settings button off a screen that
            //    has never shown a dialog.
            //  - cannot ask again. Where the app CAN still ask, backing out
            //    and coming in raises the dialog - one tap, against four in
            //    another app. Offering Settings there is not redundant, it is
            //    worse.
            offerSettings = state == CameraState.DENIED && !canAskAgain,
        )
    }

    return when (state) {
        // Already bound. Rebinding would only flicker the preview; all the
        // resume owes the operator is the prompt for the next customer.
        CameraState.RUNNING -> Resumption(startCamera = false, hint = ScanHint.POINT_AT_TICKET)

        // Never started, or refused and since allowed in Settings. The second
        // one is the bug: the permission callback is the only other place a
        // camera gets started, and it does not fire again for a permission
        // granted outside the app.
        CameraState.NOT_STARTED, CameraState.DENIED ->
            Resumption(startCamera = true, hint = ScanHint.POINT_AT_TICKET)

        // The bind threw. A resume is a natural retry point - the camera may
        // have been held by another app and freed since - but the failure
        // stands on screen until the retry actually succeeds.
        CameraState.FAILED -> Resumption(startCamera = true, hint = ScanHint.CAMERA_FAILED)
    }
}
