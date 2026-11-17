package com.hffmnnj.longbow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateStoreTest {
    private var now = 1_000_000L
    private val store = UpdateStore { now }
    private val a = "https://a.example:8443"
    private val b = "https://b.example:8443"

    @Test
    fun begin_whileAJobRuns_doesNotStartAnother() {
        assertNotNull(store.begin(a, force = false))
        assertNull(store.begin(a, force = true))
    }

    @Test
    fun begin_afterFinish_waitsUnlessForced() {
        val gen = store.begin(a, force = false)!!
        store.finish(gen)
        assertNull(store.begin(a, force = false))
        now += UpdateStore.RECHECK_MS
        assertNotNull(store.begin(a, force = false))
    }

    @Test
    fun begin_forced_startsRightAfterFinish() {
        store.finish(store.begin(a, force = false)!!)
        assertNotNull(store.begin(a, force = true))
    }

    @Test
    fun failedCheck_isRetriedSoonerThanAHealthyOne() {
        val gen = store.begin(a, force = false)!!
        store.update(gen) { it.copy(status = UpdateStatus.OFFLINE) }
        store.finish(gen)
        now += UpdateStore.RETRY_MS
        assertNotNull(store.begin(a, force = false))
    }

    @Test
    fun serverSwitch_makesTheOldJobStale_andDropsItsState() {
        val old = store.begin(a, force = false)!!
        store.update(old) { it.copy(release = ReleaseInfo("r", "1", "t", "n", 1, null)) }
        val fresh = store.begin(b, force = false)!!

        assertFalse(store.update(old) { it.copy(status = UpdateStatus.READY) })
        assertEquals(UpdateStatus.CHECKING, store.snapshot().status)
        assertNull(store.snapshot().release)
        assertEquals(b, store.snapshot().baseKey)
        assertTrue(store.isCurrent(fresh))
    }

    @Test
    fun staleFinish_doesNotReleaseTheNewerJob() {
        val old = store.begin(a, force = false)!!
        store.begin(b, force = false)!!
        store.finish(old)
        assertNull("the newer job is still running", store.begin(b, force = true))
    }

    @Test
    fun serverSwitch_abortsTheRunningTransfer() {
        val old = store.begin(a, force = false)!!
        var aborted = false
        store.setAbort(old) { aborted = true }
        store.begin(b, force = false)
        assertTrue(aborted)
    }

    @Test
    fun cancel_resetsStateAndStopsTheJob() {
        val gen = store.begin(a, force = false)!!
        store.cancel()
        assertFalse(store.update(gen) { it.copy(status = UpdateStatus.READY) })
        assertEquals(UpdateSnapshot(), store.snapshot())
    }

    @Test
    fun refresh_keepsADownloadedUpdateReady() {
        val gen = store.begin(a, force = false)!!
        store.update(gen) { it.copy(status = UpdateStatus.READY) }
        store.finish(gen)
        store.begin(a, force = true)!!
        assertEquals(UpdateStatus.READY, store.snapshot().status)
    }
}
