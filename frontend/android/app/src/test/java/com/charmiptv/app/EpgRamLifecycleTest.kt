package com.charmiptv.app

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class EpgRamLifecycleTest {
  @Test fun inFlightReadCannotRefillAfterClearOrDispose() {
    for(dispose in listOf(false,true)) {
      val started=CountDownLatch(1)
      val release=CountDownLatch(1)
      val engine=EpgRamEngine { _,_,_ ->
        started.countDown()
        check(release.await(3,TimeUnit.SECONDS))
        listOf(NativeEpgProgram("one","Programme",null,null,0,100))
      }
      val pool=Executors.newSingleThreadExecutor()
      try {
        val result=pool.submit<List<NativeEpgProgram>?> { engine.queryWindow(0,100,listOf("one")) }
        assertTrue(started.await(2,TimeUnit.SECONDS))
        if(dispose) engine.dispose() else engine.clear()
        release.countDown()
        assertTrue(result.get(2,TimeUnit.SECONDS).isNullOrEmpty())
        assertFalse("Stale read must not rewarm cleared cache",engine.isWarm())
      } finally { release.countDown();engine.dispose();pool.shutdownNow() }
    }
  }
}
