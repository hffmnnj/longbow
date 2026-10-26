package com.hffmnnj.longbow

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Restarts the trade-alerts stream after a reboot when the user left
 * notifications on in Settings.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!AlertsService.isEnabled(context)) return
        // No runtime permission to check below Tiramisu; on Tiramisu+ a
        // reboot keeps the grant, and status() already reports blocked when
        // the user denied it.
        if (AlertsService.status(context) == "blocked") return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(Intent(context, AlertsService::class.java))
        } else {
            context.startService(Intent(context, AlertsService::class.java))
        }
    }
}
