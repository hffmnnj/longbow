package com.hffmnnj.longbow

import org.json.JSONException
import org.json.JSONObject
import java.net.URI

/** A failed update step: [code] is a stable machine value Dart maps to copy. */
class UpdateException(val code: String, message: String) : Exception(message)

/** The Android build a release carries. */
data class AndroidBuild(
    val versionCode: Int,
    val versionName: String,
    val size: Long,
    val sha256: String,
)

data class ReleaseInfo(
    val id: String,
    val version: String,
    val title: String,
    val notes: String,
    val publishedAt: Long,
    val android: AndroidBuild?,
)

/** What the platform reports about an APK file or the installed app. */
data class PackageIdentity(
    val packageName: String,
    val versionCode: Long,
    /** SHA-256 hex of every current signing certificate. */
    val signers: Set<String>,
    /** True when the signing lineage declares a rotated certificate. */
    val hasSigningHistory: Boolean,
)

enum class UpdateStatus(val wire: String) {
    IDLE("idle"),
    CHECKING("checking"),
    DOWNLOADING("downloading"),
    READY("ready"),
    CURRENT("current"),
    ERROR("error"),
    OFFLINE("offline"),
}

/** Everything Flutter needs to render the update state. */
data class UpdateSnapshot(
    /** The normalized server this state belongs to; null before the first check. */
    val baseKey: String? = null,
    val status: UpdateStatus = UpdateStatus.IDLE,
    val release: ReleaseInfo? = null,
    val downloaded: Long = 0,
    val errorCode: String? = null,
    val errorMessage: String? = null,
)

/**
 * The single owner of update state and of which job may write it. Every job
 * carries the generation it was started under; a job from an older generation
 * (cancelled, or superseded by a server switch) can neither publish nor
 * release the running flag of a newer one.
 */
class UpdateStore(private val clock: () -> Long = System::currentTimeMillis) {
    companion object {
        const val RECHECK_MS = 5 * 60_000L
        const val RETRY_MS = 30_000L
    }

    private val lock = Any()
    private var generation = 0L
    private var running = false
    private var state = UpdateSnapshot()
    private var lastFinishedAt = 0L
    private var abort: (() -> Unit)? = null

    /** Called after every accepted change, outside the lock. */
    @Volatile var listener: ((UpdateSnapshot) -> Unit)? = null

    fun snapshot(): UpdateSnapshot = synchronized(lock) { state }

    fun currentGeneration(): Long = synchronized(lock) { generation }

    fun isCurrent(gen: Long): Boolean = synchronized(lock) { gen == generation }

    /**
     * Starts a job for [baseKey] and returns its generation, or null when no
     * job should start: one is already running for this server, or a
     * non-forced check came too soon after the last one. A different server
     * cancels whatever runs and drops the old server's state. A downloaded
     * update stays `ready` while a refresh runs behind it.
     */
    fun begin(baseKey: String, force: Boolean): Long? {
        val (gen, next, cancelled) = synchronized(lock) {
            var hook: (() -> Unit)? = null
            if (state.baseKey != baseKey) {
                hook = abort
                abort = null
                generation++
                running = false
                state = UpdateSnapshot(baseKey = baseKey)
            } else {
                if (running) return null
                val retrying = state.status == UpdateStatus.ERROR || state.status == UpdateStatus.OFFLINE
                val wait = if (retrying) RETRY_MS else RECHECK_MS
                if (!force && lastFinishedAt != 0L && clock() - lastFinishedAt < wait) return null
            }
            generation++
            running = true
            if (state.status != UpdateStatus.READY) {
                state = state.copy(status = UpdateStatus.CHECKING, downloaded = 0, errorCode = null, errorMessage = null)
            }
            Triple(generation, state, hook)
        }
        cancelled?.invoke()
        listener?.invoke(next)
        return gen
    }

    /** Applies [change] only while [gen] is the current generation. */
    fun update(gen: Long, change: (UpdateSnapshot) -> UpdateSnapshot): Boolean {
        val next = synchronized(lock) {
            if (gen != generation) return false
            state = change(state)
            state
        }
        listener?.invoke(next)
        return true
    }

    fun setAbort(gen: Long, hook: (() -> Unit)?) {
        synchronized(lock) { if (gen == generation) abort = hook }
    }

    fun finish(gen: Long) {
        synchronized(lock) {
            if (gen != generation) return
            running = false
            abort = null
            lastFinishedAt = clock()
        }
    }

    /** Drops all state and stops the running job's I/O. */
    fun cancel() {
        val hook = synchronized(lock) {
            val hook = abort
            abort = null
            generation++
            running = false
            state = UpdateSnapshot()
            hook
        }
        hook?.invoke()
        listener?.invoke(UpdateSnapshot())
    }
}

/**
 * Pure update rules: manifest parsing, origin and path rules, and the checks a
 * downloaded APK must pass. No Android framework types, so the unit tests run
 * on the JVM.
 */
object UpdateRules {
    const val PACKAGE_NAME = "com.hffmnnj.longbow"
    const val MAX_METADATA_BYTES = 256 * 1024
    const val MAX_APK_BYTES = 150L * 1024 * 1024
    const val MAX_VERSION_CODE = 2_100_000_000

    private const val MAX_TEXT = 200
    private const val MAX_NOTES = 64 * 1024
    private val SHA256 = Regex("^[0-9a-f]{64}$")

    /** `scheme://host[:port]` of a configured server, or null when it cannot be one. */
    fun normalizeBase(base: String): String? {
        val uri = try {
            URI(base.trim())
        } catch (_: Exception) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        if (uri.userInfo != null) return null
        return if (uri.port == -1) "$scheme://$host" else "$scheme://$host:${uri.port}"
    }

    fun metadataPath() = "/api/releases/latest"

    /** The only APK location the app downloads from; the manifest never supplies a URL. */
    fun apkPath(versionCode: Int) = "/download/releases/longbow-$versionCode.apk"

    /** Cache file for a verified download; the temp part adds the generation so cleanup stays owned. */
    fun apkName(versionCode: Int) = "longbow-$versionCode.apk"
    fun partName(versionCode: Int, gen: Long) = "${apkName(versionCode)}.$gen.part"

    /** Only the job that created it may delete a part file. */
    fun isOwnPart(fileName: String, versionCode: Int, gen: Long) = fileName == partName(versionCode, gen)

    /** Parses `GET /api/releases/latest`. Null when the server has no release yet. */
    fun parseLatest(body: String): ReleaseInfo? {
        val root = try {
            JSONObject(body)
        } catch (_: JSONException) {
            throw invalid("not a JSON object")
        }
        if (!root.has("release")) throw invalid("missing release")
        if (root.isNull("release")) return null
        val release = root.optJSONObject("release") ?: throw invalid("release is not an object")
        val android = if (!release.has("android") || release.isNull("android")) {
            null
        } else {
            parseAndroid(release.optJSONObject("android") ?: throw invalid("android is not an object"))
        }
        val publishedAt = integer(release, "publishedAt")
        if (publishedAt <= 0) throw invalid("publishedAt out of range")
        return ReleaseInfo(
            id = text(release, "id", 1),
            version = text(release, "version", 1),
            title = text(release, "title", 0),
            notes = text(release, "notes", 0, MAX_NOTES),
            publishedAt = publishedAt,
            android = android,
        )
    }

    private fun parseAndroid(json: JSONObject): AndroidBuild {
        val code = integer(json, "versionCode")
        if (code < 1 || code > MAX_VERSION_CODE) throw invalid("versionCode out of range")
        val size = integer(json, "size")
        if (size < 1 || size > MAX_APK_BYTES) throw invalid("size out of range")
        val sha = text(json, "sha256", 64, 64)
        if (!SHA256.matches(sha)) throw invalid("sha256 is not lowercase hex")
        return AndroidBuild(code.toInt(), text(json, "versionName", 1), size, sha)
    }

    private fun text(json: JSONObject, key: String, min: Int, max: Int = MAX_TEXT): String {
        val value = json.opt(key)
        if (value !is String) throw invalid("$key is not a string")
        if (value.length < min || value.length > max) throw invalid("$key has a bad length")
        return value
    }

    /** Whole JSON numbers only: strings and fractions are rejected, not coerced. */
    private fun integer(json: JSONObject, key: String): Long {
        val value = json.opt(key)
        return when (value) {
            is Int -> value.toLong()
            is Long -> value
            else -> throw invalid("$key is not an integer")
        }
    }

    private fun invalid(reason: String) = UpdateException("invalid", "Release data rejected: $reason")

    /** Whether [build] should be downloaded for an app at [installedVersionCode]. */
    fun isNewer(build: AndroidBuild, installedVersionCode: Long) = build.versionCode > installedVersionCode

    /**
     * Throws unless [archive] is the exact update promised by [build] for the
     * installed app: right package, exactly the manifest version, strictly
     * newer, and the same signing identity.
     */
    fun verifyArchive(archive: PackageIdentity, build: AndroidBuild, installed: PackageIdentity) {
        if (archive.packageName != PACKAGE_NAME) {
            throw UpdateException("package", "The download is for a different app.")
        }
        if (archive.versionCode != build.versionCode.toLong()) {
            throw UpdateException("version", "The download is not the version the server announced.")
        }
        if (archive.versionCode <= installed.versionCode) {
            throw UpdateException("version", "The download is not newer than this app.")
        }
        if (archive.hasSigningHistory) {
            throw UpdateException("signer", "The download uses a rotated signing key, which Longbow does not install.")
        }
        if (archive.signers.isEmpty() || archive.signers != installed.signers) {
            throw UpdateException("signer", "The download is not signed by the same key as this app.")
        }
    }

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
