package com.diatur.direct

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.os.SystemClock
import android.view.Surface
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicInteger

/**
 * Hardware H.264 decoding of Annex B access units straight onto a [Surface].
 *
 * Units arrive one at a time from the core and [decode] returns only when the unit is in the codec (the core
 * acknowledges the bytes to the server after that, which is the flow control). The codec is used synchronously
 * with a short wait for an input buffer; a decoder that has no free buffer is behind, so it is flushed and every
 * unit is dropped until the next IDR, which is asked for through [Listener.onKeyFrameNeeded]. Pictures are
 * released to the surface the moment the codec has them (only the newest of a burst is shown).
 *
 * [decode] and [setSurface] may be called from any thread (they serialise on one lock).
 */
internal class H264Decoder(private val listener: Listener) {
  interface Listener {
    /** A decoded picture reached the surface (decoder thread). */
    fun onPicture()

    /** The decoder needs an IDR (any thread). */
    fun onKeyFrameNeeded()

    /** Hardware decoding cannot go on: the decoder failed twice in a row or cannot start (any thread). */
    fun onFailed(reason: String)
  }

  private class Session(val codec: MediaCodec, val sps: ByteArray) {
    @Volatile var running = true

    @Volatile var flushing = false

    /** Set by the output thread when the codec broke; the next [decode] deals with it. */
    @Volatile var failure: Exception? = null
    lateinit var thread: Thread
  }

  private val lock = Any()
  private var surface: Surface? = null
  private var session: Session? = null
  private var knownSps: ByteArray? = null
  private var knownPps: ByteArray? = null

  /** Units are dropped until an IDR is queued: true whenever there is no session or the stream lost sync. */
  private var needKey = true
  private var lastKeyRequest = 0L
  private var disabled = false
  private var closed = false

  /** Failures since the last picture reached the screen. */
  private val failures = AtomicInteger()

  fun setSurface(next: Surface?) {
    synchronized(lock) {
      if (next === surface) return
      closeSession()
      surface = next
    }
  }

  fun close() {
    synchronized(lock) {
      closed = true
      closeSession()
      surface = null
    }
  }

  fun decode(annexB: ByteArray, reset: Boolean) {
    synchronized(lock) {
      if (reset) {
        disabled = false
        failures.set(0)
      }
      if (closed || disabled || surface == null) return
      val unit = H264Stream.inspect(annexB)
      unit.sps?.let { knownSps = it }
      unit.pps?.let { knownPps = it }

      session?.failure?.let { fail(it.message ?: it.javaClass.simpleName) }
      if (disabled) return
      val current = session
      if (current != null && unit.sps != null && !unit.sps.contentEquals(current.sps)) closeSession()
      if (reset) {
        needKey = true
        if (!flush(session)) return
      }
      if (!unit.hasSlice) return
      if (needKey && !unit.hasIdr) {
        requestKeyFrame(force = false)
        return
      }
      val live = session ?: openSession() ?: return
      if (!queue(live, unit, annexB)) return
      if (unit.hasIdr) needKey = false
    }
  }

  private fun queue(live: Session, unit: H264Unit, data: ByteArray): Boolean {
    try {
      var index = live.codec.dequeueInputBuffer(INPUT_TIMEOUT_US)
      if (index < 0) {
        // No free input buffer: the decoder is behind. Start over from the next key frame.
        if (!stall()) return false
        if (!unit.hasIdr) return false
        index = live.codec.dequeueInputBuffer(INPUT_TIMEOUT_US)
        if (index < 0) return fail("no input buffer")
      }
      val buffer = live.codec.getInputBuffer(index)
      if (buffer == null || buffer.capacity() < data.size) return fail("input buffer too small")
      buffer.clear()
      buffer.put(data)
      val flags = if (unit.hasIdr) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
      live.codec.queueInputBuffer(index, 0, data.size, SystemClock.elapsedRealtimeNanos() / 1000, flags)
      return true
    } catch (e: Exception) {
      return fail(e.message ?: e.javaClass.simpleName)
    }
  }

  /** Out of input buffers: flush, wait for a key frame, count it as a failure. False when decoding was given up. */
  private fun stall(): Boolean {
    val live = session ?: return false
    if (failures.incrementAndGet() >= MAX_FAILURES) {
      giveUp("decoder is not keeping up")
      return false
    }
    needKey = true
    requestKeyFrame(force = true)
    return flush(live)
  }

  private fun flush(live: Session?): Boolean {
    if (live == null) return true
    live.flushing = true
    try {
      live.codec.flush()
      return true
    } catch (e: Exception) {
      return fail(e.message ?: e.javaClass.simpleName)
    } finally {
      live.flushing = false
    }
  }

  /** The codec broke: rebuild it from the next key frame, or give up on the second failure in a row. Always false. */
  private fun fail(reason: String): Boolean {
    closeSession()
    if (failures.incrementAndGet() >= MAX_FAILURES) {
      giveUp(reason)
    } else {
      requestKeyFrame(force = true)
    }
    return false
  }

  private fun giveUp(reason: String) {
    closeSession()
    disabled = true
    failures.set(0)
    listener.onFailed(reason)
  }

  private fun openSession(): Session? {
    val target = surface?.takeIf { it.isValid } ?: return null
    val sps = knownSps
    val pps = knownPps
    if (sps == null || pps == null) {
      requestKeyFrame(force = true)
      return null
    }
    val name = HardwareH264.decoderName
    if (name == null) {
      giveUp("no hardware H.264 decoder")
      return null
    }
    val size = H264Stream.parseSize(sps)
    if (size == null) {
      giveUp("unreadable H.264 parameter sets")
      return null
    }
    if (!HardwareH264.supportsSize(size.width, size.height)) {
      giveUp("the H.264 decoder does not support ${size.width}x${size.height}")
      return null
    }
    val format = MediaFormat.createVideoFormat(HardwareH264.MIME, size.width, size.height)
    format.setByteBuffer("csd-0", ByteBuffer.wrap(H264Stream.withStartCode(sps)))
    format.setByteBuffer("csd-1", ByteBuffer.wrap(H264Stream.withStartCode(pps)))
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, (size.width * size.height).coerceIn(MIN_INPUT_SIZE, MAX_INPUT_SIZE))
    format.setInteger(MediaFormat.KEY_PRIORITY, 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)

    val codec =
      try {
        startCodec(name, format, target)
      } catch (e: Exception) {
        // The surface going away under us is not the decoder's fault: wait for the next one.
        if (target.isValid) giveUp("cannot start the H.264 decoder: ${e.message ?: e.javaClass.simpleName}")
        return null
      }
    val opened = Session(codec, sps)
    opened.thread = Thread({ drain(opened) }, "atur-screen-decode").also {
      it.isDaemon = true
      it.start()
    }
    session = opened
    return opened
  }

  private fun startCodec(name: String, format: MediaFormat, target: Surface): MediaCodec {
    val codec = MediaCodec.createByCodecName(name)
    try {
      codec.configure(format, target, null, 0)
      codec.start()
    } catch (e: Exception) {
      runCatching { codec.release() }
      throw e
    }
    return codec
  }

  /** Takes decoded pictures out of the codec and puts the newest of each burst on the surface. */
  private fun drain(live: Session) {
    val info = MediaCodec.BufferInfo()
    while (live.running) {
      try {
        var index = live.codec.dequeueOutputBuffer(info, OUTPUT_TIMEOUT_US)
        if (index < 0) continue
        var render = info.size > 0
        while (live.running) {
          val newer = live.codec.dequeueOutputBuffer(info, 0)
          if (newer < 0) break
          live.codec.releaseOutputBuffer(index, false)
          index = newer
          render = info.size > 0
        }
        live.codec.releaseOutputBuffer(index, render)
        if (render) {
          failures.set(0)
          listener.onPicture()
        }
      } catch (e: Exception) {
        if (!live.running) return
        if (live.flushing) continue
        live.failure = e
        listener.onKeyFrameNeeded()
        return
      }
    }
  }

  private fun closeSession() {
    val old = session ?: return
    session = null
    needKey = true
    old.running = false
    runCatching { old.thread.join(JOIN_TIMEOUT_MS) }
    runCatching { old.codec.stop() }
    runCatching { old.codec.release() }
  }

  private fun requestKeyFrame(force: Boolean) {
    val now = SystemClock.elapsedRealtime()
    if (!force && now - lastKeyRequest < KEY_REQUEST_INTERVAL_MS) return
    lastKeyRequest = now
    listener.onKeyFrameNeeded()
  }

  private companion object {
    const val INPUT_TIMEOUT_US = 8_000L
    const val OUTPUT_TIMEOUT_US = 10_000L
    const val JOIN_TIMEOUT_MS = 200L
    const val KEY_REQUEST_INTERVAL_MS = 1_000L
    const val MAX_FAILURES = 2
    const val MIN_INPUT_SIZE = 1 shl 20
    const val MAX_INPUT_SIZE = 8 shl 20
  }
}
