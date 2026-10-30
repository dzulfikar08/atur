package com.diatur.direct

/** What one Annex B access unit carries that the decoder cares about. NAL payloads include the header byte. */
internal class H264Unit(
  val sps: ByteArray?,
  val pps: ByteArray?,
  val hasIdr: Boolean,
  /** A coded slice (IDR or not): the unit produces a picture. */
  val hasSlice: Boolean,
)

internal class H264Size(val width: Int, val height: Int)

/** Annex B scanning and the little of the SPS the decoder needs (picture size). */
internal object H264Stream {
  private const val NAL_SLICE = 1
  private const val NAL_IDR = 5
  private const val NAL_SPS = 7
  private const val NAL_PPS = 8

  private val START_CODE = byteArrayOf(0, 0, 0, 1)

  fun inspect(data: ByteArray): H264Unit {
    var sps: ByteArray? = null
    var pps: ByteArray? = null
    var idr = false
    var slice = false
    var code = findStartCode(data, 0)
    while (code >= 0) {
      val start = code + 3
      val next = findStartCode(data, start)
      var end = if (next >= 0) next else data.size
      // The zero of a four byte start code and trailing zero bytes belong to no NAL unit.
      while (end > start && data[end - 1] == 0.toByte()) end--
      if (end > start) {
        when (data[start].toInt() and 0x1f) {
          NAL_SPS -> if (sps == null) sps = data.copyOfRange(start, end)
          NAL_PPS -> if (pps == null) pps = data.copyOfRange(start, end)
          NAL_IDR -> {
            idr = true
            slice = true
          }
          NAL_SLICE -> slice = true
        }
      }
      code = next
    }
    return H264Unit(sps, pps, idr, slice)
  }

  /** A parameter set as MediaCodec wants it in `csd-0` / `csd-1`: start code + NAL unit. */
  fun withStartCode(nal: ByteArray): ByteArray = START_CODE + nal

  private fun findStartCode(data: ByteArray, from: Int): Int {
    var i = from
    val last = data.size - 3
    while (i <= last) {
      if (data[i] == 0.toByte() && data[i + 1] == 0.toByte() && data[i + 2] == 1.toByte()) return i
      i++
    }
    return -1
  }

  /** Coded picture size after cropping, from a SPS NAL unit (header byte included); null when unreadable. */
  fun parseSize(sps: ByteArray): H264Size? =
    try {
      readSize(BitReader(unescape(sps, 1)))
    } catch (e: RuntimeException) {
      null
    }

  private fun readSize(r: BitReader): H264Size? {
    val profile = r.bits(8)
    r.bits(16) // constraint flags, level_idc
    r.ue() // seq_parameter_set_id
    var chromaFormat = 1
    var separatePlanes = false
    if (profile in HIGH_PROFILES) {
      chromaFormat = r.ue()
      if (chromaFormat == 3) separatePlanes = r.bit()
      r.ue() // bit_depth_luma_minus8
      r.ue() // bit_depth_chroma_minus8
      r.bit() // qpprime_y_zero_transform_bypass_flag
      if (r.bit()) {
        val lists = if (chromaFormat != 3) 8 else 12
        for (i in 0 until lists) {
          if (r.bit()) skipScalingList(r, if (i < 6) 16 else 64)
        }
      }
    }
    r.ue() // log2_max_frame_num_minus4
    when (r.ue()) { // pic_order_cnt_type
      0 -> r.ue()
      1 -> {
        r.bit()
        r.se()
        r.se()
        repeat(r.ue()) { r.se() }
      }
    }
    r.ue() // max_num_ref_frames
    r.bit() // gaps_in_frame_num_value_allowed_flag
    val widthMbs = r.ue() + 1
    val heightMapUnits = r.ue() + 1
    val frameMbsOnly = r.bit()
    if (!frameMbsOnly) r.bit() // mb_adaptive_frame_field_flag
    r.bit() // direct_8x8_inference_flag
    var width = widthMbs * 16
    var height = (if (frameMbsOnly) 1 else 2) * heightMapUnits * 16
    if (r.bit()) {
      val left = r.ue()
      val right = r.ue()
      val top = r.ue()
      val bottom = r.ue()
      val chromaArrayType = if (separatePlanes) 0 else chromaFormat
      val unitX = if (chromaArrayType == 1 || chromaArrayType == 2) 2 else 1
      val unitY = (if (chromaArrayType == 1) 2 else 1) * (if (frameMbsOnly) 1 else 2)
      width -= unitX * (left + right)
      height -= unitY * (top + bottom)
    }
    return if (width > 0 && height > 0) H264Size(width, height) else null
  }

  private val HIGH_PROFILES = intArrayOf(100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135)

  private fun skipScalingList(r: BitReader, size: Int) {
    var last = 8
    var next = 8
    for (j in 0 until size) {
      if (next != 0) next = (last + r.se() + 256) % 256
      if (next != 0) last = next
    }
  }

  /** RBSP of a NAL unit: payload from [from] without the 0x03 emulation prevention bytes. */
  private fun unescape(nal: ByteArray, from: Int): ByteArray {
    val out = ByteArray(nal.size - from)
    var n = 0
    var zeros = 0
    for (i in from until nal.size) {
      val b = nal[i]
      if (zeros >= 2 && b == 3.toByte()) {
        zeros = 0
        continue
      }
      out[n++] = b
      zeros = if (b == 0.toByte()) zeros + 1 else 0
    }
    return out.copyOf(n)
  }

  private class BitReader(private val data: ByteArray) {
    private var pos = 0

    fun bit(): Boolean {
      val byte = pos ushr 3
      if (byte >= data.size) throw IllegalStateException("SPS ends early")
      val value = (data[byte].toInt() ushr (7 - (pos and 7))) and 1
      pos++
      return value == 1
    }

    fun bits(count: Int): Int {
      var value = 0
      repeat(count) { value = (value shl 1) or (if (bit()) 1 else 0) }
      return value
    }

    /** Unsigned Exp-Golomb. */
    fun ue(): Int {
      var zeros = 0
      while (!bit()) {
        zeros++
        if (zeros > 31) throw IllegalStateException("bad Exp-Golomb code")
      }
      return if (zeros == 0) 0 else ((1L shl zeros) - 1 + bits(zeros).toLong()).toInt()
    }

    /** Signed Exp-Golomb. */
    fun se(): Int {
      val k = ue()
      return if (k and 1 == 1) (k + 1) / 2 else -(k / 2)
    }
  }
}
