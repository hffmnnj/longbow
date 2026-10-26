package com.hffmnnj.longbow

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Hosts the native Flutter UI and answers the `longbow/native` method
 * channel: the notifications on/off/blocked state, the server base URL the
 * foreground alert service streams from, the deep link a notification tap
 * (or a cold start from one) carries, and a shortcut into the Tailscale app.
 */
class MainActivity : FlutterActivity() {
    companion object {
        const val CHANNEL = "longbow/native"
        const val EXTRA_URL = "longbow_url"
        private const val PERMISSION_CODE = 41
        private const val TAILSCALE_PACKAGE = "com.tailscale.ipn"
        private const val TAILSCALE_DOWNLOAD = "https://tailscale.com/download"
    }

    private var methodChannel: MethodChannel? = null

    /** Enable calls waiting on the permission dialog, each with its base URL. */
    private val pendingNotifications = mutableListOf<Pair<String?, MethodChannel.Result>>()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
        methodChannel = channel
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "notificationsStatus" -> result.success(AlertsService.status(this))
                "notificationsEnable" -> handleNotificationsEnable(call.argument("baseUrl"), result)
                "notificationsDisable" -> {
                    AlertsService.setEnabled(this, false)
                    result.success("off")
                }
                "setBaseUrl" -> handleSetBaseUrl(call.argument("baseUrl"), result)
                "openTailscale" -> result.success(openTailscale())
                "getInitialUrl" -> result.success(intent?.getStringExtra(EXTRA_URL))
                else -> result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // singleTop: the app is already running, so forward the tap URL to
        // Dart, which routes it to the matching native screen.
        intent.getStringExtra(EXTRA_URL)?.let { url ->
            methodChannel?.invokeMethod("openUrl", mapOf("url" to url))
        }
    }

    private fun handleSetBaseUrl(baseUrl: String?, result: MethodChannel.Result) {
        if (baseUrl.isNullOrEmpty()) {
            result.error("no-base", "setBaseUrl needs { baseUrl }", null)
            return
        }
        AlertsService.updateBaseUrl(this, baseUrl)
        result.success(null)
    }

    /**
     * Opens the Tailscale app so the user can connect the VPN, falling back
     * to the download page when it is not installed. Returns true when the
     * app itself was launched. Needs the `<package>` query in the manifest
     * for the launch-intent lookup on Android 11+.
     */
    private fun openTailscale(): Boolean {
        val launch = packageManager.getLaunchIntentForPackage(TAILSCALE_PACKAGE)
        if (launch != null) {
            startActivity(launch)
            return true
        }
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(TAILSCALE_DOWNLOAD)))
        return false
    }

    private fun handleNotificationsEnable(baseUrl: String?, result: MethodChannel.Result) {
        if (baseUrl.isNullOrEmpty()) {
            result.error("no-base", "notificationsEnable needs { baseUrl }", null)
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            AlertsService.setEnabled(this, true, baseUrl)
            result.success("on")
            return
        }
        // Complete when the permission dialog answers. A second enable call
        // while the dialog is up joins the same outcome.
        if (pendingNotifications.isEmpty()) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), PERMISSION_CODE)
        }
        pendingNotifications.add(Pair(baseUrl, result))
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != PERMISSION_CODE) return
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        val waiting = pendingNotifications.toList()
        pendingNotifications.clear()
        if (granted) {
            val base = waiting.firstNotNullOfOrNull { it.first }
            if (base != null) AlertsService.setEnabled(this, true, base)
            waiting.forEach { it.second.success("on") }
        } else {
            AlertsService.setEnabled(this, false)
            waiting.forEach { it.second.success("blocked") }
        }
    }
}
