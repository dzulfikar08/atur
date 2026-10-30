package com.diatur.direct

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import android.widget.LinearLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The computer's screen of one Direct connection. It draws the newest picture stretched over its own bounds (JS
 * lays it out at the right aspect ratio and zooms with a transform, which a [TextureView] follows).
 *
 * Two kinds of pictures come in through the connection's sink, both on core threads:
 * - H.264 access units, decoded by [H264Decoder] onto the texture's surface;
 * - complete RGBA pictures (ZRLE), copied into a reusable [Bitmap] and drawn with `lockCanvas`.
 * A texture's surface belongs to one producer at a time, so when the kind changes (the app reopened the screen with
 * another codec) the texture view is replaced by a fresh one.
 *
 * Threads: props, attach/detach and the texture callbacks run on the main thread; `onVideo` / `onFrame` on a core
 * thread; the decoder's output thread reports pictures. [lock] guards the texture state shared between them and is
 * never held while calling into [decoder].
 */
class AturScreenView(context: Context, appContext: AppContext) : ExpoView(context, appContext), TextureView.SurfaceTextureListener {
  private enum class Mode { NONE, VIDEO, CANVAS }

  override val shouldUseAndroidLayout = true

  private val onFirstPicture by EventDispatcher()
  private val onDecoderError by EventDispatcher()

  private val lock = Any()
  private var textureView: TextureView // guarded by lock
  private var surface: Surface? = null // guarded by lock
  private var available = false // guarded by lock
  private var mode = Mode.NONE // guarded by lock
  private var rebuilding = false // guarded by lock
  private var bitmap: Bitmap? = null // guarded by lock
  private var destroyed = false // guarded by lock
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val target = Rect()

  @Volatile private var connection: String? = null

  /** True until the first picture after attach / reopen has been reported. */
  private val firstPending = AtomicBoolean(true)

  private val decoderListener =
    object : H264Decoder.Listener {
      override fun onPicture() = pictureShown()

      override fun onKeyFrameNeeded() = requestKeyFrame()

      override fun onFailed(reason: String) {
        post { if (!isDestroyed()) onDecoderError(mapOf("reason" to reason)) }
      }
    }
  private val decoder = H264Decoder(decoderListener)

  init {
    setBackgroundColor(Color.BLACK)
    textureView = newTextureView()
    addView(textureView)
  }

  /** Prop `connection`: the Direct connection id whose screen this view shows. */
  fun setConnection(id: String) {
    val previous = connection
    if (id == previous) return
    if (previous != null) ScreenRegistry.detach(previous, this)
    connection = id
    firstPending.set(true)
    if (isAttachedToWindow) {
      ScreenRegistry.attach(id, this)
      requestKeyFrame()
    }
  }

  /** The view was dropped by React Native: release everything for good. */
  fun destroy() {
    connection?.let { ScreenRegistry.detach(it, this) }
    synchronized(lock) { destroyed = true }
    decoder.close()
    synchronized(lock) {
      bitmap?.recycle()
      bitmap = null
      surface?.release()
      surface = null
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    firstPending.set(true)
    connection?.let {
      ScreenRegistry.attach(it, this)
      requestKeyFrame()
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    connection?.let { ScreenRegistry.detach(it, this) }
    // The texture view already gave its surface back; make sure no codec outlives it.
    decoder.setSurface(null)
  }

  // ---- texture lifecycle (main thread)

  override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
    val created = Surface(texture)
    synchronized(lock) {
      surface = created
      available = true
      mode = Mode.NONE
    }
    decoder.setSurface(created)
    // Nothing is on the new surface yet: ask for a key frame / full picture.
    requestKeyFrame()
  }

  override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
    synchronized(lock) {
      available = false
      mode = Mode.NONE
    }
    // The codec must be gone before the texture is released.
    decoder.setSurface(null)
    synchronized(lock) {
      surface?.release()
      surface = null
    }
    return true
  }

  override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
    requestKeyFrame()
  }

  override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {}

  private fun newTextureView(): TextureView =
    TextureView(context).also {
      it.isOpaque = true
      it.surfaceTextureListener = this
      it.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

  /** Swaps in a fresh texture view so that the surface can be taken by the other kind of picture (main thread). */
  private fun rebuildTextureView() {
    val fresh = newTextureView()
    val old =
      synchronized(lock) {
        available = false
        mode = Mode.NONE
        textureView
      }
    old.surfaceTextureListener = null
    decoder.setSurface(null)
    synchronized(lock) {
      surface?.release()
      surface = null
      textureView = fresh
    }
    removeView(old)
    if (!isDestroyed()) addView(fresh)
    synchronized(lock) { rebuilding = false }
  }

  /** The kind of picture may use the texture now: false when there is no surface yet or it is being replaced. */
  private fun claim(wanted: Mode): Boolean {
    var replace = false
    val granted =
      synchronized(lock) {
        when {
          destroyed || rebuilding || !available -> false
          mode == Mode.NONE || mode == wanted -> {
            mode = wanted
            true
          }
          else -> {
            rebuilding = true
            replace = true
            false
          }
        }
      }
    if (replace) post { rebuildTextureView() }
    return granted
  }

  // ---- pictures (core threads)

  /** One H.264 access unit (Annex B); `reset` starts a new decoding context. */
  internal fun onVideo(annexB: ByteArray, reset: Boolean) {
    if (!claim(Mode.VIDEO)) return
    if (reset) firstPending.set(true)
    decoder.decode(annexB, reset)
  }

  /** A complete picture: `width * height * 4` bytes in R, G, B, A order. */
  internal fun onFrame(width: Int, height: Int, rgba: ByteArray) {
    if (width <= 0 || height <= 0 || rgba.size.toLong() < width.toLong() * height * 4) return
    if (!claim(Mode.CANVAS)) return
    synchronized(lock) {
      if (destroyed || !available) return
      val image = bitmapFor(width, height)
      image.copyPixelsFromBuffer(ByteBuffer.wrap(rgba))
      val canvas = textureView.lockCanvas() ?: return
      try {
        target.set(0, 0, canvas.width, canvas.height)
        canvas.drawBitmap(image, null, target, paint)
      } finally {
        textureView.unlockCanvasAndPost(canvas)
      }
    }
    pictureShown()
  }

  /** The reusable bitmap, replaced only when the desktop changes size. Call with [lock] held. */
  private fun bitmapFor(width: Int, height: Int): Bitmap {
    val current = bitmap
    if (current != null && current.width == width && current.height == height) return current
    current?.recycle()
    return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap = it }
  }

  // ---- events and refresh

  private fun isDestroyed(): Boolean = synchronized(lock) { destroyed }

  private fun pictureShown() {
    if (firstPending.compareAndSet(true, false)) {
      post { if (!isDestroyed()) onFirstPicture(emptyMap()) }
    }
  }

  private fun requestKeyFrame() {
    connection?.let { ScreenRegistry.requestKeyFrame(it) }
  }
}
