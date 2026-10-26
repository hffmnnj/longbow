package com.hffmnnj.longbow

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.print.PrintManager
import android.webkit.WebView
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.webviewflutter.WebViewFlutterAndroidExternalApi

/**
 * Hosts the WebView and answers the `longbow/native` method channel the Dart
 * bridge calls into: printing through Android's PrintManager, the
 * notifications on/off/blocked state, and the deep link a notification tap
 * (or a cold start from one) carries.
 */
class MainActivity : FlutterActivity() {
    companion object {
        const val CHANNEL = "longbow/native"
        const val EXTRA_URL = "longbow_url"
        private const val PERMISSION_CODE = 41
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
                "print" -> handlePrint(call.argument<Number>("identifier"), call.argument("title"), result)
                "notificationsStatus" -> result.success(AlertsService.status(this))
                "notificationsEnable" -> handleNotificationsEnable(call.argument("baseUrl"), result)
                "notificationsDisable" -> {
                    AlertsService.setEnabled(this, false)
                    result.success("off")
                }
                "getInitialUrl" -> result.success(intent?.getStringExtra(EXTRA_URL))
                else -> result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // singleTop: the app is already running, so forward the tap URL to
        // Dart, which loads it in the existing WebView.
        intent.getStringExtra(EXTRA_URL)?.let { url ->
            methodChannel?.invokeMethod("openUrl", mapOf("url" to url))
        }
    }

    private fun handlePrint(identifier: Number?, title: String?, result: MethodChannel.Result) {
        val id = identifier?.toLong()
        if (id == null) {
            result.error("no-webview", "print needs the WebView identifier", null)
            return
        }
        val engine = flutterEngine
        if (engine == null) {
            result.error("no-engine", "Flutter engine is not attached", null)
            return
        }
        @Suppress("DEPRECATION")
        val webView: WebView? = WebViewFlutterAndroidExternalApi.getWebView(engine, id)
        if (webView == null) {
            result.error("no-webview", "No WebView for identifier $id", null)
            return
        }
        val adapter = webView.createPrintDocumentAdapter("Longbow")
        val printManager = getSystemService(PrintManager::class.java)
        if (printManager == null) {
            result.error("no-print", "PrintManager is unavailable", null)
            return
        }
        printManager.print(title?.ifEmpty { "Longbow report" } ?: "Longbow report", adapter, null)
        result.success(null)
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
