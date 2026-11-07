package ng.gsds.qrpark

/**
 * The account's job decides the app's one screen. It comes from the login
 * response (`user.role` and the location's kind), never from a setting or a
 * toggle, and there is no switching. The backend enforces the job on every
 * request; this only decides what is shown.
 */
enum class Mode(val opensEntry: Boolean) {
    /** An entry operator at an entry gate. */
    ENTRY(true),

    /** A payment operator: the booth screen arrives in 4b. */
    BOOTH_LATER(false),

    /** An exit operator: the exit screen arrives in 4c. */
    EXIT_LATER(false),

    /** An admin: the Admin Portal, not this app. */
    ADMIN(false),

    /** Anything else, including an entry operator without an entry gate. */
    NONE(false),
}

/** [role] is `user.role`, [locationKind] the `gate.direction` of the login response. */
fun modeFor(role: String?, locationKind: String?): Mode = when (role) {
    "ENTRY_OPERATOR" -> if (locationKind == "ENTRY") Mode.ENTRY else Mode.NONE
    "PAYMENT_OPERATOR" -> Mode.BOOTH_LATER
    "EXIT_OPERATOR" -> Mode.EXIT_LATER
    "ADMIN" -> Mode.ADMIN
    else -> Mode.NONE
}

/** What the holding screen says for a mode that has no screen in this app yet. */
fun holdingText(mode: Mode): String = when (mode) {
    Mode.BOOTH_LATER -> "Booth mode: coming in 4b"
    Mode.EXIT_LATER -> "Exit mode: coming in 4c"
    Mode.ADMIN -> "Admin accounts use the Admin Portal"
    Mode.NONE, Mode.ENTRY -> "This account has no job on this app. Ask the admin."
}
