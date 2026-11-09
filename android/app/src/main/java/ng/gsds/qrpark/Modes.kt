package ng.gsds.qrpark

/**
 * The account's job decides the app's one screen. It comes from the login
 * response (`user.role` and the location's kind), never from a setting or a
 * toggle, and there is no switching. The backend enforces the job on every
 * request; this only decides what is shown.
 */
enum class Mode(val opensEntry: Boolean, val opensBooth: Boolean = false, val opensExit: Boolean = false) {
    /** An entry operator at an entry gate. */
    ENTRY(true),

    /** A payment operator at a booth (Sprint 4b). */
    BOOTH(false, opensBooth = true),

    /** An exit operator at an exit gate (Sprint 4c). */
    EXIT(false, opensExit = true),

    /** An admin: the Admin Portal, not this app. */
    ADMIN(false),

    /** Anything else, including an operator without a location of the right kind. */
    NONE(false),
}

/** [role] is `user.role`, [locationKind] the `gate.direction` of the login response. */
fun modeFor(role: String?, locationKind: String?): Mode = when (role) {
    "ENTRY_OPERATOR" -> if (locationKind == "ENTRY") Mode.ENTRY else Mode.NONE
    "PAYMENT_OPERATOR" -> if (locationKind == "BOOTH") Mode.BOOTH else Mode.NONE
    "EXIT_OPERATOR" -> if (locationKind == "EXIT") Mode.EXIT else Mode.NONE
    "ADMIN" -> Mode.ADMIN
    else -> Mode.NONE
}

/** What the holding screen says for a mode that has no screen in this app yet. */
fun holdingText(mode: Mode): String = when (mode) {
    Mode.ADMIN -> "Admin accounts use the Admin Portal"
    Mode.NONE, Mode.ENTRY, Mode.BOOTH, Mode.EXIT -> "This account has no job on this app. Ask the admin."
}
