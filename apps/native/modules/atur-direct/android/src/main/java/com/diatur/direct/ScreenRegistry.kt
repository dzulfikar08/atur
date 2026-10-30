package com.diatur.direct

import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import uniffi.atur_mobile.Direct
import uniffi.atur_mobile.ScreenSink

/**
 * Which [AturScreenView] shows which connection. The sink of a connection looks its view up here for every picture,
 * so pictures that arrive while no view is attached are simply dropped. Views are held weakly: the registry never
 * keeps one alive.
 */
internal object ScreenRegistry {
  private val views = ConcurrentHashMap<String, WeakReference<AturScreenView>>()
  private val directs = ConcurrentHashMap<String, Direct>()

  // A refresh goes into the core from another thread: the sink callbacks run on a core thread and must not call back
  // into it while they are being served.
  private val refresher =
    Executors.newSingleThreadExecutor { task -> Thread(task, "atur-screen-refresh").also { it.isDaemon = true } }

  fun attach(connection: String, view: AturScreenView) {
    views[connection] = WeakReference(view)
  }

  fun detach(connection: String, view: AturScreenView) {
    val ref = views[connection] ?: return
    val shown = ref.get()
    if (shown == null || shown === view) views.remove(connection, ref)
  }

  fun viewFor(connection: String): AturScreenView? = views[connection]?.get()

  fun register(connection: String, direct: Direct) {
    directs[connection] = direct
  }

  fun unregister(connection: String, direct: Direct) {
    directs.remove(connection, direct)
  }

  /** Asks the computer for a full update / key frame (`screenRefresh`); ignored when nothing is connected. */
  fun requestKeyFrame(connection: String) {
    val direct = directs[connection] ?: return
    refresher.execute { runCatching { direct.fire("screenRefresh", "{}") } }
  }
}

/** The binary media of one connection (video access units and ZRLE pictures) on its way to the attached view. */
internal class ConnectionScreenSink(private val connection: String) : ScreenSink {
  // These run on a core thread and must never throw into it.
  override fun onVideo(annexB: ByteArray, reset: Boolean) {
    try {
      ScreenRegistry.viewFor(connection)?.onVideo(annexB, reset)
    } catch (e: Throwable) {
      // A picture the view could not take is as good as a dropped one.
    }
  }

  override fun onFrame(width: UInt, height: UInt, rgba: ByteArray) {
    try {
      ScreenRegistry.viewFor(connection)?.onFrame(width.toInt(), height.toInt(), rgba)
    } catch (e: Throwable) {
      // See onVideo.
    }
  }
}
