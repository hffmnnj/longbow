package com.hffmnnj.longbow

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Finds, downloads and verifies a newer Longbow APK from the configured
 * server, then hands it to the system installer when the user taps Install.
 *
 * One job runs at a time, under a generation owned by [UpdateStore]; a server
 * switch or cancel makes a running job stale, so it can no longer publish
 * state, and it removes only its own temporary file. The APK is only ever
 * fetched from the fixed same-origin path, redirects are rejected, and the
 * file is checked for size, SHA-256, package, exact version, and signing
 * identity before it is called ready, and again when the user taps Install.
 */
object AppUpdater {
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val PROGRESS_INTERVAL_MS = 250L
    private const val SPACE_MARGIN = 32L * 1024 * 1024
    private const val PROVIDER_SUFFIX = ".updates"
    private const val APK_MIME = "application/vnd.android.package-archive"

    val store = UpdateStore()
    private val main = Handler(Looper.getMainLooper())

    /**
     * Every filesystem touch (download, sweep, verify, install check) runs
     * here in order. Begin already reserved the generation, so a queued job
     * that lost the race sees it is not current and exits before deleting
     * anything a newer job owns.
     */
    private val io = Executors.newSingleThreadExecutor { r ->
        Thread(r, "longbow-update").apply { isDaemon = true }
    }

    private fun updatesDir(context: Context): File =
        File(context.cacheDir, "updates").also { it.mkdirs() }

    /**
     * Starts a check unless one is running or the last one was recent (see
     * [UpdateStore.begin]); [force] skips the recency wait. Safe from any
     * thread; the work runs on its own thread.
     */
    fun check(context: Context, base: String, force: Boolean) {
        val key = UpdateRules.normalizeBase(base) ?: return
        val app = context.applicationContext
        val gen = store.begin(key, force) ?: return
        // Queued behind the current generation; runJob re-checks before touching files.
        io.execute { runJob(app, key, gen) }
    }

    fun cancel() = store.cancel()

    fun installedIdentity(context: Context): PackageInfo {
        @Suppress("DEPRECATION")
        return context.packageManager.getPackageInfo(context.packageName, signatureFlags())
    }

    fun toMap(context: Context, snapshot: UpdateSnapshot = store.snapshot()): Map<String, Any?> {
        val installed = installedIdentity(context)
        val release = snapshot.release
        val build = release?.android
        return mapOf(
            "status" to snapshot.status.wire,
            "errorCode" to snapshot.errorCode,
            "errorMessage" to snapshot.errorMessage,
            "release" to release?.let {
                mapOf(
                    "id" to it.id,
                    "version" to it.version,
                    "title" to it.title,
                    "notes" to it.notes,
                    "publishedAt" to it.publishedAt,
                )
            },
            "android" to build?.let {
                mapOf(
                    "versionCode" to it.versionCode,
                    "versionName" to it.versionName,
                    "size" to it.size,
                )
            },
            "downloaded" to snapshot.downloaded,
            "installedVersionCode" to versionCodeOf(installed),
            "installedVersionName" to (installed.versionName ?: ""),
            "canInstall" to canInstall(context),
        )
    }

    fun canInstall(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /** Opens this app's "Install unknown apps" switch. Only called from a user tap. */
    fun openInstallSettings(activity: Activity) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
        activity.startActivity(intent)
    }

    /**
     * Re-verifies the ready APK and opens the system installer on it. Reports
     * `started`, `needsPermission`, `notReady`, or `invalid` through [done] on
     * the main thread. Nothing launches unless the user called this.
     */
    fun install(activity: Activity, done: (String) -> Unit) {
        val snapshot = store.snapshot()
        val build = snapshot.release?.android
        if (snapshot.status != UpdateStatus.READY || build == null) {
            done("notReady")
            return
        }
        if (!canInstall(activity)) {
            done("needsPermission")
            return
        }
        val gen = store.currentGeneration()
        val app = activity.applicationContext
        // Serialized with downloads: verification and any delete happen on the
        // updater thread while the generation is still owned, never in the
        // delayed main callback that could race a newer job's target.
        io.execute {
            val file = File(updatesDir(app), UpdateRules.apkName(build.versionCode))
            val failure: UpdateException? = try {
                verifyFile(app, file, build)
                null
            } catch (e: UpdateException) {
                e
            } catch (e: IOException) {
                UpdateException("storage", "The downloaded update could not be read.")
            } catch (_: Exception) {
                UpdateException("failed", "The update failed.")
            }
            if (failure != null) {
                // Only the current generation owns the shared target name; a
                // stale verification must not delete a newer job's file.
                if (store.isCurrent(gen)) {
                    try {
                        file.delete()
                    } catch (_: Exception) {
                    }
                    store.update(gen) {
                        it.copy(status = UpdateStatus.ERROR, errorCode = failure.code, errorMessage = failure.message)
                    }
                }
                main.post {
                    if (!store.isCurrent(gen)) {
                        done("notReady")
                    } else {
                        done("invalid")
                    }
                }
                return@execute
            }
            main.post {
                // The generation may have turned while verification ran; never
                // publish or launch for a stale job.
                if (!store.isCurrent(gen)) {
                    done("notReady")
                    return@post
                }
                try {
                    launchInstaller(activity, file)
                    done("started")
                } catch (_: Exception) {
                    store.update(gen) {
                        it.copy(status = UpdateStatus.ERROR, errorCode = "launch", errorMessage = "Could not open the installer.")
                    }
                    done("invalid")
                }
            }
        }
    }

    private fun launchInstaller(activity: Activity, file: File) {
        val uri = FileProvider.getUriForFile(activity, activity.packageName + PROVIDER_SUFFIX, file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.startActivity(intent)
    }

    // region job

    private fun runJob(app: Context, base: String, gen: Long) {
        // Queued behind a newer generation (server switch or cancel): exit
        // before touching any shared file.
        if (!store.isCurrent(gen)) return
        var part: File? = null
        val wasReady = store.snapshot().status == UpdateStatus.READY
        try {
            val dir = updatesDir(app)
            if (!store.isCurrent(gen)) return
            // Only the current job sweeps; stale jobs never reach here.
            sweep(dir) { it.name.endsWith(".part") }
            val release = fetchRelease(base, gen)
            if (!store.update(gen) { it.copy(release = release) }) return
            val installed = versionCodeOf(installedIdentity(app))
            val build = release?.android
            if (release == null || build == null || !UpdateRules.isNewer(build, installed)) {
                if (!store.isCurrent(gen)) return
                sweep(dir) { it.name.endsWith(".apk") }
                store.update(gen) { it.copy(status = UpdateStatus.CURRENT, downloaded = 0) }
                if (release != null) announce(app, base, gen, release, ready = false)
                return
            }
            val target = File(dir, UpdateRules.apkName(build.versionCode))
            if (target.exists()) {
                try {
                    verifyFile(app, target, build)
                    ready(app, base, gen, dir, target)
                    return
                } catch (_: UpdateException) {
                    if (!store.isCurrent(gen)) return
                    try { target.delete() } catch (_: Exception) { }
                } catch (_: IOException) {
                    if (!store.isCurrent(gen)) return
                    try { target.delete() } catch (_: Exception) { }
                } catch (_: Exception) {
                    if (!store.isCurrent(gen)) return
                    try { target.delete() } catch (_: Exception) { }
                }
            }
            if (!store.isCurrent(gen)) return
            if (dir.usableSpace < build.size + SPACE_MARGIN) {
                throw UpdateException("storage", "Not enough free space for the update.")
            }
            if (!store.update(gen) { it.copy(status = UpdateStatus.DOWNLOADING, downloaded = 0) }) return
            part = File(dir, UpdateRules.partName(build.versionCode, gen))
            download(base, gen, build, part)
            if (!store.isCurrent(gen)) return
            if (!part.renameTo(target)) throw UpdateException("storage", "The update could not be saved.")
            part = null
            try {
                verifyFile(app, target, build)
            } catch (e: Exception) {
                // Only the owner that just renamed may remove; stale already returned above.
                if (store.isCurrent(gen)) {
                    try { target.delete() } catch (_: Exception) { }
                }
                throw e
            }
            ready(app, base, gen, dir, target)
        } catch (e: UpdateException) {
            fail(gen, wasReady, e.code, e.message ?: "The update failed.", offline = false)
        } catch (e: IOException) {
            fail(gen, wasReady, "unreachable", "Could not reach the server.", offline = true)
        } catch (e: Exception) {
            fail(gen, wasReady, "failed", "The update failed.", offline = false)
        } finally {
            try { part?.delete() } catch (_: Exception) { }
            store.finish(gen)
        }
    }

    private fun ready(app: Context, base: String, gen: Long, dir: File, target: File) {
        if (!store.update(gen) { it.copy(status = UpdateStatus.READY, downloaded = it.release?.android?.size ?: 0) }) return
        sweep(dir) { it.name.endsWith(".apk") && it.name != target.name }
        store.snapshot().release?.let { announce(app, base, gen, it, ready = true) }
    }

    const val RELEASE_TAG_PREFIX = "release-"
    private const val PREFS = "longbow"

    private fun announcedKey(baseKey: String) = "release_announced:$baseKey"

    /** Records that the user has been told about release [id] on [base], so it is not announced again. */
    fun markAnnounced(context: Context, base: String, id: String) {
        val key = UpdateRules.normalizeBase(base) ?: return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(announcedKey(key), id).apply()
    }

    /**
     * Posts one local alert per new release id, only while trade alerts are
     * on. The first release seen on a server is a baseline, not news. The
     * tag matches the server's live alert, so the two replace each other, and
     * a live alert marks the id before the updater can post its own.
     */
    private fun announce(app: Context, base: String, gen: Long, release: ReleaseInfo, ready: Boolean) {
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = announcedKey(base)
        val seen = prefs.getString(key, null)
        if (seen == release.id) return
        prefs.edit().putString(key, release.id).apply()
        if (seen == null || !store.isCurrent(gen) || AlertsService.status(app) != "on") return
        val title = release.title.ifBlank { "Longbow ${release.version}" }
        val body = if (ready) "Longbow ${release.android?.versionName ?: release.version} is ready to install." else "Longbow ${release.version} is out."
        AlertsService.notifyAlert(app, title, body, "/?settings=updates", RELEASE_TAG_PREFIX + release.id)
    }

    /** A refresh that fails behind an already downloaded update leaves it usable. */
    private fun fail(gen: Long, wasReady: Boolean, code: String, message: String, offline: Boolean) {
        store.update(gen) {
            if (wasReady && it.status == UpdateStatus.READY) {
                it
            } else {
                it.copy(
                    status = if (offline) UpdateStatus.OFFLINE else UpdateStatus.ERROR,
                    errorCode = code,
                    errorMessage = message,
                )
            }
        }
    }

    /** Deletes matching files directly inside [dir], one by one; never recurses. */
    private fun sweep(dir: File, match: (File) -> Boolean) {
        dir.listFiles()?.forEach { if (it.isFile && match(it)) it.delete() }
    }

    private fun open(base: String, path: String, gen: Long, accept: String): HttpURLConnection {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = false
        conn.connectTimeout = CONNECT_TIMEOUT_MS
        conn.readTimeout = READ_TIMEOUT_MS
        conn.setRequestProperty("Accept", accept)
        conn.setRequestProperty("Accept-Encoding", "identity")
        store.setAbort(gen) { conn.disconnect() }
        return conn
    }

    private fun requireOk(conn: HttpURLConnection) {
        val code = conn.responseCode
        if (code in 300..399) throw UpdateException("redirect", "The server redirected the request, which is not allowed.")
        if (code == HttpURLConnection.HTTP_NOT_FOUND) throw UpdateException("missing", "The server does not have that file.")
        if (code != HttpURLConnection.HTTP_OK) throw UpdateException("server", "The server answered $code.")
    }

    private fun fetchRelease(base: String, gen: Long): ReleaseInfo? {
        val conn = open(base, UpdateRules.metadataPath(), gen, "application/json")
        try {
            requireOk(conn)
            if (conn.contentLengthLong > UpdateRules.MAX_METADATA_BYTES) {
                throw UpdateException("invalid", "Release data is too large.")
            }
            val body = readBounded(conn.inputStream, UpdateRules.MAX_METADATA_BYTES)
            return UpdateRules.parseLatest(String(body, Charsets.UTF_8))
        } finally {
            conn.disconnect()
        }
    }

    private fun readBounded(input: InputStream, limit: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        input.use {
            while (true) {
                val n = it.read(buffer)
                if (n < 0) break
                if (out.size() + n > limit) throw UpdateException("invalid", "Release data is too large.")
                out.write(buffer, 0, n)
            }
        }
        return out.toByteArray()
    }

    private fun download(base: String, gen: Long, build: AndroidBuild, part: File) {
        val conn = open(base, UpdateRules.apkPath(build.versionCode), gen, APK_MIME)
        try {
            requireOk(conn)
            val declared = conn.contentLengthLong
            if (declared != -1L && declared != build.size) {
                throw UpdateException("size", "The download is not the announced size.")
            }
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            var lastPublish = 0L
            val buffer = ByteArray(64 * 1024)
            conn.inputStream.use { input ->
                FileOutputStream(part).use { out ->
                    while (true) {
                        if (!store.isCurrent(gen)) return
                        val n = input.read(buffer)
                        if (n < 0) break
                        total += n
                        if (total > build.size) throw UpdateException("size", "The download is larger than announced.")
                        digest.update(buffer, 0, n)
                        out.write(buffer, 0, n)
                        val now = System.currentTimeMillis()
                        if (now - lastPublish >= PROGRESS_INTERVAL_MS) {
                            lastPublish = now
                            val soFar = total
                            store.update(gen) { it.copy(downloaded = soFar) }
                        }
                    }
                    out.fd.sync()
                }
            }
            if (total != build.size) throw UpdateException("size", "The download is not the announced size.")
            if (UpdateRules.hex(digest.digest()) != build.sha256) {
                throw UpdateException("hash", "The download does not match its checksum.")
            }
        } finally {
            conn.disconnect()
        }
    }

    // endregion

    // region verification

    private fun signatureFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }

    private fun versionCodeOf(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }

    private fun identityOf(info: PackageInfo): PackageIdentity {
        val certs: Array<android.content.pm.Signature>?
        var history = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signing = info.signingInfo
            certs = signing?.apkContentsSigners
            history = signing?.hasPastSigningCertificates() ?: false
        } else {
            @Suppress("DEPRECATION")
            certs = info.signatures
        }
        val signers = certs.orEmpty().map { UpdateRules.hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }.toSet()
        return PackageIdentity(info.packageName ?: "", versionCodeOf(info), signers, history)
    }

    /** Size, hash, then package, version and signer checks of the file at [file]. */
    private fun verifyFile(app: Context, file: File, build: AndroidBuild) {
        if (!file.isFile || file.length() != build.size) {
            throw UpdateException("size", "The downloaded update is not the announced size.")
        }
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        if (UpdateRules.hex(digest.digest()) != build.sha256) {
            throw UpdateException("hash", "The downloaded update does not match its checksum.")
        }
        @Suppress("DEPRECATION")
        val archive = app.packageManager.getPackageArchiveInfo(file.path, signatureFlags())
            ?: throw UpdateException("package", "The download is not a valid app package.")
        UpdateRules.verifyArchive(identityOf(archive), build, identityOf(installedIdentity(app)))
    }

    // endregion
}
