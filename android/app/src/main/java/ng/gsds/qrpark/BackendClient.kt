package ng.gsds.qrpark

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * The only route from this app to the backend.
 *
 * - Never calculates an amount: amounts are read from responses, in integer
 *   kobo, and shown with naira().
 * - Never sends a time: the backend and the database set every time.
 * - Never logs anything: no URL, token, header or body reaches a log
 *   (SourceRulesTest), and an error shown to the operator is the backend's
 *   own message or a fixed sentence, never the request.
 * - One request at a time (a single worker thread), answered on the main thread.
 *
 * Adapted from eparking 359c0c1 android/pos/.../BackendClient.kt: the same
 * HttpURLConnection transport and the one-refresh-on-401 rule; the Log.w on
 * failure removed; the visit, charge and pass calls replaced by this app's
 * routes (docs/api.md); X-Device-Id on every ticket call.
 */
object BackendClient {

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    /** One HTTP exchange. [status] null means no reply at all (no connection, timeout). */
    class Reply(val status: Int?, val text: String) {
        val ok: Boolean get() = status != null && status in 200..299

        /** NestJS sends `message` as a string or an array of strings. */
        val message: String
            get() {
                val json = runCatching { JSONObject(text) }.getOrNull() ?: return "The server had a problem (HTTP $status)."
                json.optJSONArray("message")?.let { a -> return (0 until a.length()).joinToString("\n") { a.optString(it) } }
                return json.optString("message").ifBlank { "The server had a problem (HTTP $status)." }
            }

        fun json(): JSONObject? = runCatching { JSONObject(text) }.getOrNull()
        fun array(): JSONArray? = runCatching { JSONArray(text) }.getOrNull()
    }

    // ---------------------------------------------------------------- auth

    fun login(session: Session, username: String, password: String, then: (Reply) -> Unit) {
        val body = JSONObject().put("username", username).put("password", password)
        call("POST", "/auth/login", body, token = null, deviceId = null) { reply ->
            reply.json()?.takeIf { reply.ok }?.let(session::save)
            then(reply)
        }
    }

    /** Ends every session of this account on the backend; the app forgets it either way. */
    fun logout(session: Session, then: () -> Unit) {
        val token = session.accessToken
        session.logOut()
        if (token == null) return then()
        call("POST", "/auth/logout", null, token, deviceId = null) { then() }
    }

    // --------------------------------------------------------------- entry

    fun categories(session: Session, then: (Reply) -> Unit) = authed(session, "GET", "/categories", null, then)

    fun createTicket(session: Session, attempt: OpenAttempt, then: (CreateOutcome) -> Unit) {
        val body = JSONObject().put("categoryCode", attempt.categoryCode).put("idempotencyKey", attempt.key)
        authed(session, "POST", "/tickets", body) { reply ->
            then(classifyCreate(reply.status, if (reply.ok) reply.json()?.let(::ticketOf) else null, if (reply.ok) "" else reply.message))
        }
    }

    fun recent(session: Session, then: (Reply) -> Unit) = authed(session, "GET", "/tickets/recent", null, then)

    fun lookup(session: Session, suffix: String, then: (Reply) -> Unit) =
        authed(session, "GET", "/tickets/lookup?suffix=" + URLEncoder.encode(suffix, "UTF-8"), null, then)

    fun reprint(session: Session, ticketId: String, then: (Reply) -> Unit) =
        authed(session, "POST", "/tickets/reprint", JSONObject().put("ticketId", ticketId), then)

    fun check(session: Session, scanned: String, then: (CheckReply) -> Unit) =
        authed(session, "POST", "/tickets/check", JSONObject().put("token", scanned)) { reply -> then(checkReplyOf(reply)) }

    // ------------------------------------------------------------- parsing

    /** The full ticket of POST /tickets and /tickets/reprint, or null if it cannot be read. */
    fun ticketOf(json: JSONObject): IssuedTicket? = try {
        val header = json.optJSONObject("header")
        IssuedTicket(
            id = json.getString("id"),
            ticketNumber = json.getString("ticketNumber"),
            token = json.getString("token"),
            categoryName = json.getString("categoryName"),
            feeKobo = json.getLong("feeKobo"),
            issuedAt = json.getString("issuedAt"),
            gateName = json.optJSONObject("gate")?.optString("name").orEmpty(),
            header = HeaderText.of(
                displayName = header?.optStringOrNull("displayName"),
                orgName = header?.optStringOrNull("receiptOrgName"),
                contactLine = header?.optStringOrNull("receiptContactLine"),
            ),
        )
    } catch (_: JSONException) {
        null
    }

    private fun checkReplyOf(reply: Reply): CheckReply {
        val status = reply.status ?: return CheckReply.NoConnection
        if (status == 401) return CheckReply.SignInAgain
        if (status in 400..499) return CheckReply.Refused(reply.message)
        val json = reply.json()?.takeIf { reply.ok } ?: return CheckReply.ServerError
        val ticket = json.optJSONObject("ticket")
        return CheckReply.Result(
            result = json.optString("result"),
            ticketNumber = ticket?.optStringOrNull("ticketNumber") ?: json.optStringOrNull("ticketNumber"),
            feeKobo = ticket?.takeIf { it.has("feeKobo") }?.optLong("feeKobo"),
            usedAt = json.optStringOrNull("usedAt"),
            usedGateName = json.optJSONObject("usedGate")?.optStringOrNull("name"),
            usedByName = json.optJSONObject("usedBy")?.optStringOrNull("name"),
            usedByYou = json.optBoolean("usedByYou", false),
        )
    }

    // ------------------------------------------------------------- transport

    /** An authenticated call, spending the refresh token once on a 401. */
    private fun authed(session: Session, method: String, path: String, body: JSONObject?, then: (Reply) -> Unit) {
        val device = session.deviceId
        call(method, path, body, session.accessToken, device) { first ->
            val refresh = session.refreshToken
            if (first.status != 401 || refresh.isNullOrBlank()) return@call then(first)
            call("POST", "/auth/refresh", JSONObject().put("refreshToken", refresh), null, null) { refreshed ->
                when {
                    refreshed.ok && refreshed.json() != null -> {
                        session.save(refreshed.json()!!)
                        call(method, path, body, session.accessToken, device, then)
                    }
                    refreshed.status == null -> then(refreshed)
                    else -> {
                        session.logOut()
                        then(Reply(401, "{\"message\":\"Your session has ended. Sign in again.\"}"))
                    }
                }
            }
        }
    }

    private fun call(method: String, path: String, body: JSONObject?, token: String?, deviceId: String?, then: (Reply) -> Unit) {
        io.execute {
            val reply = blocking(method, path, body, token, deviceId)
            main.post { then(reply) }
        }
    }

    private fun blocking(method: String, path: String, body: JSONObject?, token: String?, deviceId: String?): Reply {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(BuildConfig.API_BASE_URL + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10_000
                readTimeout = 20_000
                useCaches = false
                setRequestProperty("Accept", "application/json")
                if (token != null) setRequestProperty("Authorization", "Bearer $token")
                if (deviceId != null) setRequestProperty("X-Device-Id", deviceId)
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            Reply(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
        } catch (_: IOException) {
            // No reply: the request may or may not have reached the backend.
            Reply(null, "")
        } finally {
            connection?.disconnect()
        }
    }
}

/** A string field, or null when it is missing, JSON null or blank. */
fun JSONObject.optStringOrNull(name: String): String? =
    if (isNull(name)) null else optString(name).takeIf { it.isNotBlank() }
