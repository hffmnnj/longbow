package com.hffmnnj.longbow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class UpdateRulesTest {
    private val sha = "a".repeat(64)

    private fun release(android: String) = """
        {"release":{"id":"r1","version":"1.0.2","title":"T","notes":"N","publishedAt":1700000000000,"android":$android}}
    """.trimIndent()

    private fun android(
        versionCode: String = "3",
        size: String = "1000",
        sha256: String = "\"$sha\"",
    ) = """{"versionCode":$versionCode,"versionName":"1.0.2","size":$size,"sha256":$sha256}"""

    private fun rejected(body: String): UpdateException {
        try {
            UpdateRules.parseLatest(body)
        } catch (e: UpdateException) {
            return e
        }
        fail("expected the manifest to be rejected: $body")
        throw AssertionError()
    }

    @Test
    fun parseLatest_noReleaseYet_isNull() {
        assertNull(UpdateRules.parseLatest("""{"release":null}"""))
    }

    @Test
    fun parseLatest_serverOnlyRelease_hasNoAndroidBuild() {
        val parsed = UpdateRules.parseLatest(release("null"))!!
        assertEquals("r1", parsed.id)
        assertNull(parsed.android)
    }

    @Test
    fun parseLatest_validAndroidBuild_keepsEveryField() {
        val build = UpdateRules.parseLatest(release(android()))!!.android!!
        assertEquals(AndroidBuild(3, "1.0.2", 1000, sha), build)
    }

    @Test
    fun parseLatest_malformedManifests_areRejectedAsInvalid() {
        val maxSize = UpdateRules.MAX_APK_BYTES
        val bodies = listOf(
            "not json",
            "{}",
            """{"release":"x"}""",
            release(android(versionCode = "\"3\"")),
            release(android(versionCode = "3.5")),
            release(android(versionCode = "0")),
            release(android(versionCode = "2100000001")),
            release(android(size = "0")),
            release(android(size = "${maxSize + 1}")),
            release(android(size = "1000.0")),
            release(android(sha256 = "\"${"A".repeat(64)}\"")),
            release(android(sha256 = "\"${"a".repeat(63)}\"")),
            release("[]"),
            release(android()).replace("\"id\":\"r1\"", "\"id\":\"\""),
            release(android()).replace("1700000000000", "\"1700000000000\""),
        )
        for (body in bodies) assertEquals(body, "invalid", rejected(body).code)
    }

    @Test
    fun parseLatest_acceptsLargestAllowedBuild() {
        val build = UpdateRules.parseLatest(
            release(android(versionCode = "2100000000", size = "${UpdateRules.MAX_APK_BYTES}")),
        )!!.android!!
        assertEquals(2_100_000_000, build.versionCode)
        assertEquals(UpdateRules.MAX_APK_BYTES, build.size)
    }

    @Test
    fun apkPath_isTheFixedVersionedLocation() {
        assertEquals("/download/releases/longbow-42.apk", UpdateRules.apkPath(42))
    }

    @Test
    fun normalizeBase_keepsOriginOnly_andRejectsForeignShapes() {
        assertEquals("https://host.ts.net:8443", UpdateRules.normalizeBase("HTTPS://Host.ts.net:8443/"))
        assertEquals("http://100.1.2.3:4520", UpdateRules.normalizeBase("http://100.1.2.3:4520"))
        assertNull(UpdateRules.normalizeBase("ftp://host"))
        assertNull(UpdateRules.normalizeBase("http://user:pw@host"))
        assertNull(UpdateRules.normalizeBase("not a url"))
    }

    private val build = AndroidBuild(3, "1.0.2", 1000, sha)
    private val installed = PackageIdentity(UpdateRules.PACKAGE_NAME, 2, setOf("signer-a"), false)
    private val good = PackageIdentity(UpdateRules.PACKAGE_NAME, 3, setOf("signer-a"), false)

    private fun verifyFails(archive: PackageIdentity, build: AndroidBuild = this.build): String {
        try {
            UpdateRules.verifyArchive(archive, build, installed)
        } catch (e: UpdateException) {
            return e.code
        }
        fail("expected verification to fail for $archive")
        throw AssertionError()
    }

    @Test
    fun verifyArchive_exactNewerBuildFromSameSigner_passes() {
        UpdateRules.verifyArchive(good, build, installed)
    }

    @Test
    fun verifyArchive_rejectsWrongPackage() {
        assertEquals("package", verifyFails(good.copy(packageName = "com.example.other")))
    }

    @Test
    fun verifyArchive_rejectsVersionThatIsNotExactlyTheManifest() {
        assertEquals("version", verifyFails(good.copy(versionCode = 4)))
    }

    @Test
    fun verifyArchive_rejectsAnythingNotStrictlyNewer() {
        val sameAsInstalled = build.copy(versionCode = 2)
        assertEquals("version", verifyFails(good.copy(versionCode = 2), sameAsInstalled))
    }

    @Test
    fun verifyArchive_rejectsDifferentOrMissingSigner() {
        assertEquals("signer", verifyFails(good.copy(signers = setOf("signer-b"))))
        assertEquals("signer", verifyFails(good.copy(signers = setOf("signer-a", "signer-b"))))
        assertEquals("signer", verifyFails(good.copy(signers = emptySet())))
    }

    @Test
    fun verifyArchive_rejectsSignerRotationLineage() {
        assertEquals("signer", verifyFails(good.copy(hasSigningHistory = true)))
    }

    @Test
    fun isNewer_isStrict() {
        assertTrue(UpdateRules.isNewer(build, 2))
        assertFalse(UpdateRules.isNewer(build, 3))
        assertFalse(UpdateRules.isNewer(build, 4))
    }

    @Test
    fun partName_isVersionedWithGenerationSoCleanupStaysOwned() {
        assertEquals("longbow-3.apk", UpdateRules.apkName(3))
        assertEquals("longbow-3.apk.7.part", UpdateRules.partName(3, 7))
        assertTrue(UpdateRules.isOwnPart("longbow-3.apk.7.part", 3, 7))
        assertFalse(UpdateRules.isOwnPart("longbow-3.apk.8.part", 3, 7))
        assertFalse(UpdateRules.isOwnPart("longbow-3.apk", 3, 7))
        assertFalse(UpdateRules.isOwnPart("longbow-4.apk.7.part", 3, 7))
    }

    @Test
    fun store_staleGenerationCannotPublishOrReleaseTheRunningJob() {
        var now = 0L
        val store = UpdateStore(clock = { now })
        val first = store.begin("https://a", false)!!
        assertTrue(store.isCurrent(first))
        // While running, a second check for the same server coalesces.
        assertNull(store.begin("https://a", true))

        // A server switch cancels the old job: it is stale from here on.
        val second = store.begin("https://b", false)!!
        assertFalse(store.isCurrent(first))
        assertTrue(store.isCurrent(second))

        // Stale jobs neither publish nor release the running flag.
        assertFalse(store.update(first) { it.copy(status = UpdateStatus.READY) })
        assertTrue(store.update(second) { it.copy(status = UpdateStatus.CHECKING) })
        store.finish(first)
        // The current job still runs, so a new check still coalesces.
        assertNull(store.begin("https://b", true))
        store.finish(second)

        // Cancel drops state and stales everything queued behind it.
        val third = store.begin("https://b", true)!!
        store.cancel()
        assertFalse(store.isCurrent(third))
        assertFalse(store.update(third) { it.copy(status = UpdateStatus.READY) })
    }
}
