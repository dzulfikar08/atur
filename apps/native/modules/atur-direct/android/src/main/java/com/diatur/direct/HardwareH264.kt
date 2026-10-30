package com.diatur.direct

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build

/** The hardware H.264 decoder of this device, if there is one (a software decoder is too slow for a desktop). */
internal object HardwareH264 {
  const val MIME = "video/avc"

  private val info: MediaCodecInfo? by lazy {
    try {
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { isHardwareDecoder(it) }
    } catch (e: RuntimeException) {
      null
    }
  }

  val decoderName: String? get() = info?.name

  val available: Boolean get() = info != null

  /** False when the decoder cannot take pictures of this size; true when unknown. */
  fun supportsSize(width: Int, height: Int): Boolean =
    try {
      info?.getCapabilitiesForType(MIME)?.videoCapabilities?.isSizeSupported(width, height) ?: true
    } catch (e: RuntimeException) {
      true
    }

  private fun isHardwareDecoder(codec: MediaCodecInfo): Boolean {
    if (codec.isEncoder || codec.supportedTypes.none { it.equals(MIME, ignoreCase = true) }) return false
    val name = codec.name.lowercase()
    if (name.endsWith(".secure")) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      return codec.isHardwareAccelerated && !codec.isSoftwareOnly
    }
    return !name.startsWith("omx.google.") && !name.startsWith("c2.android.") && !name.startsWith("c2.google.")
  }
}
