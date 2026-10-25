package com.hffmnnj.longbow

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import org.json.JSONObject

/**
 * Holds the server-sent event stream at `GET <base>/api/push/native-stream`
 * open from a foreground service and posts each payload as a native
 * notification: the same title, body, url, and tag the web push subscribers
 * get, so the app and the browser notify identically.
 *
 * A repeated tag replaces the earlier notification, as web push does. Tapping
 * one opens the app and loads `<base><url>` in the WebView. The service's own
 * persistent notification sits on a low-importance "Connection" channel with
 * no actions.
 */
class AlertsService : Service() {
    companion object {
        private const val PREFS = "longbow"
        private const val KEY_ENABLED = "notifications_enabled"
        private const val KEY_BASE_URL = "notifications_base_url"

        private const val CHANNEL_ALERTS = "trade-alerts"
        private const val CHANNEL_STATUS = "connection"
        private const val STATUS_ID = 1

        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 70_000
        private const val MIN_BACKOFF_MS = 2_000L
        private const val MAX_BACKOFF_MS = 60_000L

        fun isEnabled(context: Context): Boolean =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_ENABLED, false)

        fun baseUrl(context: Context): String? =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_BASE_URL, null)

        /** Persists the Settings toggle and starts or stops the service. */
        fun setEnabled(context: Context, enabled: Boolean, baseUrl: String? = null) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            prefs.edit().also { editor ->
                editor.putBoolean(KEY_ENABLED, enabled)
                if (baseUrl != null) editor.putString(KEY_BASE_URL, baseUrl)
            }.apply()
            if (enabled) start(context) else stop(context)
        }

        /** "on" when the toggle is on, "blocked" when the user denied notifications, else "off". */
        fun status(context: Context): String {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_DENIED
            ) {
                return "blocked"
            }
            return if (isEnabled(context)) "on" else "off"
        }

        fun start(context: Context) {
            val intent = Intent(context, AlertsService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AlertsService::class.java))
        }
    }

    @Volatile private var running = false
    private var worker: Thread? = null
    private var connection: HttpURLConnection? = null
    private val wake = Any()
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
        watchConnectivity()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val status = statusNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(STATUS_ID, status, serviceType())
        } else {
            @Suppress("DEPRECATION")
            startForeground(STATUS_ID, status)
        }
        if (worker?.isAlive != true) {
            running = true
            worker = Thread(::streamLoop, "longbow-alerts").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        try {
            connection?.disconnect()
        } catch (_: Exception) {
        }
        synchronized(wake) { (wake as java.lang.Object).notifyAll() }
        networkCallback?.let {
            try {
                getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it)
            } catch (_: Exception) {
            }
        }
        networkCallback = null
        worker?.interrupt()
        worker = null
        super.onDestroy()
    }

    private fun serviceType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, "Trade alerts", NotificationManager.IMPORTANCE_HIGH),
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_STATUS, "Connection", NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun statusNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_alert)
            .setContentTitle("Longbow")
            .setContentText("Watching for trades")
            .setOngoing(true)
            .setShowWhen(false)
            .build()

    /** Wakes the backoff sleep early when connectivity returns. */
    private fun watchConnectivity() {
        val manager = getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                synchronized(wake) { (wake as java.lang.Object).notifyAll() }
            }

            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                    synchronized(wake) { (wake as java.lang.Object).notifyAll() }
                }
            }
        }
        try {
            manager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (_: Exception) {
        }
    }

    private fun streamLoop() {
        var backoff = MIN_BACKOFF_MS
        while (running) {
            val base = baseUrl(this)
            if (base.isNullOrEmpty()) {
                // Enabled without a base (should not happen); wait for the
                // next enable call rather than spinning.
                sleepInterruptible(MIN_BACKOFF_MS)
                continue
            }
            try {
                streamOnce(base)
                backoff = MIN_BACKOFF_MS
            } catch (_: InterruptedException) {
                return
            } catch (_: Exception) {
                // Dropped stream or refused connection: back off and retry.
            }
            if (!running) return
            sleepInterruptible(backoff)
            backoff = minOf(backoff * 2, MAX_BACKOFF_MS)
        }
    }

    /** Blocks until the stream drops or the service stops. Throws on failure. */
    private fun streamOnce(base: String) {
        val url = URL(base.trimEnd('/') + "/api/push/native-stream")
        val conn = (url.openConnection() as HttpURLConnection).also { connection = it }
        try {
            conn.setRequestProperty("Accept", "text/event-stream")
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            // The server pings every 25 s; silence past this means a dead route (network switch, tailnet reconnect).
            conn.readTimeout = READ_TIMEOUT_MS
            conn.connect()
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IllegalStateException("native-stream answered ${conn.responseCode}")
            }
            BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8)).use { reader ->
                val event = StringBuilder()
                while (running) {
                    val line = reader.readLine() ?: throw IllegalStateException("stream closed")
                    if (line.startsWith(":")) continue // `: ping` comments.
                    if (line.startsWith("data:")) {
                        event.append(line.removePrefix("data:").trim()).append('\n')
                        continue
                    }
                    if (line.isEmpty() && event.isNotEmpty()) {
                        postPayload(event.toString())
                        event.clear()
                    }
                }
            }
        } finally {
            if (connection === conn) connection = null
            try {
                conn.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private fun postPayload(data: String) {
        val json = try {
            JSONObject(data)
        } catch (_: Exception) {
            return
        }
        val title = json.optString("title").ifEmpty { return }
        val body = json.optString("body").ifEmpty { null }
        val url = json.optString("url").ifEmpty { null }
        val tag = json.optString("tag").ifEmpty { null }
        val base = baseUrl(this) ?: return

        val open = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            if (url != null) putExtra(MainActivity.EXTRA_URL, url)
        }
        val tap = PendingIntent.getActivity(
            this,
            tag?.hashCode() ?: 0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_alert)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setShowWhen(true)
            .build()
        getSystemService(NotificationManager::class.java)
            ?.notify(tag?.hashCode() ?: 0, notification)
    }

    private fun sleepInterruptible(ms: Long) {
        try {
            synchronized(wake) { (wake as java.lang.Object).wait(ms) }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw e
        }
    }
}
