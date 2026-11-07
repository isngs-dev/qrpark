package ng.gsds.qrpark

import android.content.Context
import org.json.JSONObject

/**
 * The signed-in account, as login and refresh return it: tokens, the user,
 * the location and the site. All of it in the encrypted store.
 *
 * The mode comes from here (the account's job), never from a setting.
 *
 * Adapted from eparking 359c0c1 android/pos/.../Session.kt: plain
 * SharedPreferences replaced by SecureStore (sealed values, Keystore key);
 * username login; the location (gate) and its kind kept; the counter-only
 * fields (pass rules, card printer, counter label) dropped; the open entry
 * attempt and the installation id added.
 */
class Session(context: Context) {

    private val store = SecureStore(context)

    val attempts = EntryAttempts(StoredAttempt(store))

    val accessToken: String? get() = store[SecureStore.Slot.ACCESS]
    val refreshToken: String? get() = store[SecureStore.Slot.REFRESH]
    val username: String get() = store[SecureStore.Slot.USERNAME].orEmpty()
    val name: String get() = store[SecureStore.Slot.NAME].orEmpty()
    val role: String get() = store[SecureStore.Slot.ROLE].orEmpty()
    val gateName: String get() = store[SecureStore.Slot.GATE_NAME].orEmpty()
    val siteName: String get() = store[SecureStore.Slot.SITE_NAME].orEmpty()
    private val gateKind: String? get() = store[SecureStore.Slot.GATE_KIND]

    val mode: Mode get() = modeFor(role, gateKind)

    val isSignedIn: Boolean get() = !accessToken.isNullOrBlank() && username.isNotBlank()

    /** Made once, kept across sign-ins; sent as X-Device-Id. */
    val deviceId: String
        get() = deviceIdFrom(load = { store[SecureStore.Slot.DEVICE_ID] }, save = { store[SecureStore.Slot.DEVICE_ID] = it })

    /** The body of a 200 from /auth/login or /auth/refresh. */
    fun save(body: JSONObject) {
        store[SecureStore.Slot.ACCESS] = body.optString("accessToken")
        store[SecureStore.Slot.REFRESH] = body.optString("refreshToken")
        body.optJSONObject("user")?.let {
            store[SecureStore.Slot.USERNAME] = it.optString("username")
            store[SecureStore.Slot.NAME] = it.optString("name")
            store[SecureStore.Slot.ROLE] = it.optString("role")
        }
        val gate = body.optJSONObject("gate")
        store[SecureStore.Slot.GATE_CODE] = gate?.optString("code")
        store[SecureStore.Slot.GATE_NAME] = gate?.optString("name")
        store[SecureStore.Slot.GATE_KIND] = gate?.optString("direction")
        store[SecureStore.Slot.SITE_NAME] = body.optJSONObject("site")?.optString("displayName")
        // Another account's open attempt is discarded; this account's is kept.
        attempts.onSignedIn(username)
    }

    /**
     * Forget the account, keep the device: the installation id and the open
     * attempt stay (the attempt is discarded only when a different account
     * signs in).
     */
    fun logOut() {
        TicketHolder.current = null
        store.clear(
            listOf(
                SecureStore.Slot.ACCESS, SecureStore.Slot.REFRESH, SecureStore.Slot.USERNAME, SecureStore.Slot.NAME, SecureStore.Slot.ROLE,
                SecureStore.Slot.GATE_CODE, SecureStore.Slot.GATE_NAME, SecureStore.Slot.GATE_KIND, SecureStore.Slot.SITE_NAME,
            ),
        )
    }
}

/** The ticket on screen, with its token. In memory only: never on disk, never in an Intent. */
object TicketHolder {
    @Volatile
    var current: IssuedTicket? = null
}
