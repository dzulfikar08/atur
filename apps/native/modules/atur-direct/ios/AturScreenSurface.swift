import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import QuartzCore
import UIKit
import VideoToolbox

/// kVTInvalidSessionErr: the session was invalidated by the system (typically after backgrounding).
private let vtInvalidSessionError: OSStatus = -12903

/// A picture older than this counts as "a new picture" for onFirstPicture (reopened channel).
private let pictureGapNanos: UInt64 = 2_000_000_000
/// Minimum spacing of key frame requests while waiting for an IDR.
private let refreshSpacingNanos: UInt64 = 500_000_000
/// Largest framebuffer edge accepted for ZRLE pictures.
private let maxPictureEdge = 16384

/// Whether this device has a hardware H.264 decoder (the `screenH264` module constant).
func screenHardwareH264Available() -> Bool {
  return VTIsHardwareDecodeSupported(kCMVideoCodecType_H264)
}

/// One access unit split into the parts the decoder needs.
struct AnnexBUnit {
  var sps: [UInt8]?
  var pps: [UInt8]?
  /// Slice NAL units (types 1 to 5) as length-prefixed (AVCC, 4 byte big endian) samples.
  var avcc: [UInt8] = []
  var hasIDR = false
}

func parseAnnexB(_ data: Data) -> AnnexBUnit {
  var unit = AnnexBUnit()
  data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Void in
    let p = raw.bindMemory(to: UInt8.self)
    let n = p.count
    var starts: [Int] = []
    var i = 0
    while i + 3 <= n {
      if p[i] == 0 && p[i + 1] == 0 && p[i + 2] == 1 {
        starts.append(i + 3)
        i += 3
      } else {
        i += 1
      }
    }
    unit.avcc.reserveCapacity(n)
    for (k, s) in starts.enumerated() {
      var e = k + 1 < starts.count ? starts[k + 1] - 3 : n
      while e > s && p[e - 1] == 0 { e -= 1 }
      if e <= s { continue }
      let type = p[s] & 0x1f
      switch type {
      case 7:
        if unit.sps == nil { unit.sps = Array(UnsafeBufferPointer(rebasing: p[s..<e])) }
      case 8:
        if unit.pps == nil { unit.pps = Array(UnsafeBufferPointer(rebasing: p[s..<e])) }
      case 1...5:
        if type == 5 { unit.hasIDR = true }
        let length = UInt32(e - s)
        unit.avcc.append(UInt8(truncatingIfNeeded: length >> 24))
        unit.avcc.append(UInt8(truncatingIfNeeded: length >> 16))
        unit.avcc.append(UInt8(truncatingIfNeeded: length >> 8))
        unit.avcc.append(UInt8(truncatingIfNeeded: length))
        unit.avcc.append(contentsOf: UnsafeBufferPointer(rebasing: p[s..<e]))
      default:
        break
      }
    }
  }
  return unit
}

/// Filled by the VideoToolbox output handler, read by the decoding thread after the frame finished.
private final class DecodeResult: @unchecked Sendable {
  var status: OSStatus = noErr
  var buffer: CVImageBuffer?
}

private enum ScreenMode {
  case none
  case video
  case image
}

/// Draws the screen of one connection: H.264 through VideoToolbox onto an AVSampleBufferDisplayLayer,
/// ZRLE pictures as CGImage contents of a plain layer. All state is guarded by `lock`; the core
/// feeds it on its own thread and returning from `receive*` is what acknowledges the bytes, so at
/// most one unit is in flight and a slow decode slows the stream instead of queueing it.
final class ScreenSurface: @unchecked Sendable {
  let rootLayer = CALayer()
  private let displayLayer = AVSampleBufferDisplayLayer()
  private let imageLayer = CALayer()

  private let lock = NSLock()
  private var connectionId: String?
  private var active = true
  private var mode = ScreenMode.none

  private var sps: [UInt8]?
  private var pps: [UInt8]?
  private var format: CMVideoFormatDescription?
  private var session: VTDecompressionSession?
  private var needKeyFrame = true
  private var failures = 0
  private var errorReported = false
  private var frameIndex: Int64 = 0

  private var firstPicturePending = true
  private var lastPictureNanos: UInt64 = 0
  private var lastRefreshNanos: UInt64 = 0
  private var lastWidth = 0
  private var lastHeight = 0

  private var onFirstPicture: (@Sendable () -> Void)?
  private var onDecoderError: (@Sendable (String) -> Void)?
  private var observers: [NSObjectProtocol] = []

  init() {
    rootLayer.backgroundColor = UIColor.black.cgColor
    rootLayer.masksToBounds = true
    displayLayer.videoGravity = .resize
    displayLayer.isHidden = true
    imageLayer.contentsGravity = .resize
    imageLayer.magnificationFilter = .linear
    imageLayer.isHidden = true
    rootLayer.addSublayer(displayLayer)
    rootLayer.addSublayer(imageLayer)

    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
      ) { [weak self] _ in
        self?.setActive(false)
      })
    observers.append(
      center.addObserver(
        forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil
      ) { [weak self] _ in
        self?.setActive(true)
      })
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    if let id = connectionId {
      ScreenHub.shared.detach(self, from: id)
    }
    dropSessionLocked()
  }

  // MARK: - Hosting view API

  func setHandlers(
    onFirstPicture: @escaping @Sendable () -> Void,
    onDecoderError: @escaping @Sendable (String) -> Void
  ) {
    lock.lock()
    defer { lock.unlock() }
    self.onFirstPicture = onFirstPicture
    self.onDecoderError = onDecoderError
  }

  /// Sizes the layers to the hosting view; the picture is stretched over the whole bounds.
  func layout(size: CGSize) {
    let frame = CGRect(origin: .zero, size: size)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    rootLayer.frame = frame
    displayLayer.frame = frame
    imageLayer.frame = frame
    CATransaction.commit()
  }

  /// Attaches to a connection (nil or empty detaches). Starts from a clean decoder and asks the
  /// computer for a full update / key frame.
  func attach(connectionId newId: String?) {
    let id = (newId?.isEmpty ?? true) ? nil : newId
    lock.lock()
    defer { lock.unlock() }
    if id == connectionId { return }
    if let old = connectionId {
      ScreenHub.shared.detach(self, from: old)
    }
    connectionId = id
    resetLocked()
    clearLayersLocked()
    if let id {
      ScreenHub.shared.attach(self, to: id)
      requestRefreshLocked(force: true)
    }
  }

  // MARK: - Media from the core

  func receiveVideo(_ data: Data, reset: Bool) {
    lock.lock()
    defer { lock.unlock() }
    guard connectionId != nil, active else { return }

    let unit = parseAnnexB(data)
    if reset {
      resetLocked()
      firstPicturePending = true
    }

    if let newSps = unit.sps, let newPps = unit.pps, !newSps.isEmpty, !newPps.isEmpty {
      if newSps != sps || newPps != pps || format == nil {
        dropSessionLocked()
        guard let newFormat = makeFormat(sps: newSps, pps: newPps) else {
          failLocked("cannot read the H.264 parameter sets", immediate: true)
          return
        }
        sps = newSps
        pps = newPps
        format = newFormat
        needKeyFrame = true
      }
    }

    guard let activeFormat = format else {
      requestRefreshLocked(force: false)
      return
    }
    if needKeyFrame {
      guard unit.hasIDR else {
        requestRefreshLocked(force: false)
        return
      }
    }
    if unit.avcc.isEmpty { return }

    if session == nil {
      guard let created = makeSession(activeFormat) else {
        failLocked("cannot start the H.264 decoder", immediate: true)
        return
      }
      session = created
    }
    guard let activeSession = session, let sample = makeSample(unit.avcc, format: activeFormat)
    else {
      failLocked("cannot build an H.264 sample", immediate: false)
      return
    }
    needKeyFrame = false

    let result = DecodeResult()
    var infoFlags = VTDecodeInfoFlags()
    let status = VTDecompressionSessionDecodeFrame(
      activeSession, sampleBuffer: sample, flags: [], infoFlagsOut: &infoFlags
    ) { status, _, imageBuffer, _, _ in
      result.status = status
      result.buffer = imageBuffer
    }
    if status == noErr {
      _ = VTDecompressionSessionWaitForAsynchronousFrames(activeSession)
    }

    let outcome = status != noErr ? status : result.status
    if outcome == vtInvalidSessionError {
      // The system took the session away: build a new one and wait for the next IDR.
      dropSessionLocked()
      needKeyFrame = true
      requestRefreshLocked(force: true)
      return
    }
    if outcome != noErr {
      failLocked("H.264 decode failed (\(outcome))", immediate: false)
      return
    }
    guard let buffer = result.buffer else { return }

    failures = 0
    errorReported = false
    display(buffer)
  }

  func receivePicture(width: Int, height: Int, rgba: Data) {
    lock.lock()
    defer { lock.unlock() }
    guard connectionId != nil, active else { return }
    guard width > 0, height > 0, width <= maxPictureEdge, height <= maxPictureEdge,
      rgba.count >= width * height * 4,
      let image = makeImage(width: width, height: height, rgba: rgba)
    else { return }

    if mode == .video {
      // The server switched to pictures: the video decoder is not needed any more.
      resetLocked()
    }
    if width != lastWidth || height != lastHeight {
      lastWidth = width
      lastHeight = height
      firstPicturePending = true
    }
    showLocked(.image)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    imageLayer.contents = image
    CATransaction.commit()
    notePictureLocked()
  }

  // MARK: - Application state

  private func setActive(_ isActive: Bool) {
    lock.lock()
    defer { lock.unlock() }
    if active == isActive { return }
    active = isActive
    // VideoToolbox sessions do not survive the background: drop it now, rebuild on the next IDR.
    dropSessionLocked()
    needKeyFrame = true
    if isActive {
      requestRefreshLocked(force: true)
    } else {
      displayLayer.flush()
    }
  }

  // MARK: - Decoder (callers hold `lock`)

  private func makeFormat(sps: [UInt8], pps: [UInt8]) -> CMVideoFormatDescription? {
    var description: CMVideoFormatDescription?
    let status = sps.withUnsafeBufferPointer { spsBuffer -> OSStatus in
      pps.withUnsafeBufferPointer { ppsBuffer -> OSStatus in
        guard let spsBase = spsBuffer.baseAddress, let ppsBase = ppsBuffer.baseAddress else {
          return -1
        }
        let pointers: [UnsafePointer<UInt8>] = [spsBase, ppsBase]
        let sizes: [Int] = [spsBuffer.count, ppsBuffer.count]
        return CMVideoFormatDescriptionCreateFromH264ParameterSets(
          allocator: kCFAllocatorDefault,
          parameterSetCount: 2,
          parameterSetPointers: pointers,
          parameterSetSizes: sizes,
          nalUnitHeaderLength: 4,
          formatDescriptionOut: &description)
      }
    }
    return status == noErr ? description : nil
  }

  private func makeSession(_ format: CMVideoFormatDescription) -> VTDecompressionSession? {
    let specification: [CFString: Any] = [
      kVTVideoDecoderSpecification_EnableHardwareAcceleratedVideoDecoder: true
    ]
    let attributes: [CFString: Any] = [
      kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
      kCVPixelBufferIOSurfacePropertiesKey: [String: Any](),
    ]
    var newSession: VTDecompressionSession?
    let status = VTDecompressionSessionCreate(
      allocator: kCFAllocatorDefault,
      formatDescription: format,
      decoderSpecification: specification as CFDictionary,
      imageBufferAttributes: attributes as CFDictionary,
      outputCallback: nil,
      decompressionSessionOut: &newSession)
    guard status == noErr, let created = newSession else { return nil }
    _ = VTSessionSetProperty(
      created, key: kVTDecompressionPropertyKey_RealTime, value: kCFBooleanTrue)
    return created
  }

  private func makeSample(_ avcc: [UInt8], format: CMVideoFormatDescription) -> CMSampleBuffer? {
    let count = avcc.count
    var newBlock: CMBlockBuffer?
    guard
      CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault,
        memoryBlock: nil,
        blockLength: count,
        blockAllocator: kCFAllocatorDefault,
        customBlockSource: nil,
        offsetToData: 0,
        dataLength: count,
        flags: CMBlockBufferFlags(kCMBlockBufferAssureMemoryNowFlag),
        blockBufferOut: &newBlock) == kCMBlockBufferNoErr,
      let block = newBlock
    else { return nil }
    let copied = avcc.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> OSStatus in
      guard let base = bytes.baseAddress else { return -1 }
      return CMBlockBufferReplaceDataBytes(
        with: base, blockBuffer: block, offsetIntoDestination: 0, dataLength: count)
    }
    guard copied == kCMBlockBufferNoErr else { return nil }

    frameIndex += 1
    var timing = CMSampleTimingInfo(
      duration: .invalid,
      presentationTimeStamp: CMTime(value: frameIndex, timescale: 60),
      decodeTimeStamp: .invalid)
    var size = count
    var sample: CMSampleBuffer?
    let status = CMSampleBufferCreateReady(
      allocator: kCFAllocatorDefault,
      dataBuffer: block,
      formatDescription: format,
      sampleCount: 1,
      sampleTimingEntryCount: 1,
      sampleTimingArray: &timing,
      sampleSizeEntryCount: 1,
      sampleSizeArray: &size,
      sampleBufferOut: &sample)
    return status == noErr ? sample : nil
  }

  /// Invalidates the VideoToolbox session; the format description is kept for the next rebuild.
  private func dropSessionLocked() {
    if let current = session {
      VTDecompressionSessionInvalidate(current)
    }
    session = nil
  }

  private func resetLocked() {
    dropSessionLocked()
    needKeyFrame = true
    failures = 0
    errorReported = false
    format = nil
    sps = nil
    pps = nil
  }

  /// A decode failure: recreate the session, wait for an IDR (asking for one), and after two in a
  /// row (or when the decoder cannot start at all) tell the app to fall back to pictures.
  private func failLocked(_ reason: String, immediate: Bool) {
    failures += 1
    dropSessionLocked()
    needKeyFrame = true
    requestRefreshLocked(force: false)
    if (immediate || failures >= 2) && !errorReported {
      errorReported = true
      onDecoderError?(reason)
    }
  }

  // MARK: - Output (callers hold `lock`)

  private func display(_ pixelBuffer: CVPixelBuffer) {
    var newPictureFormat: CMVideoFormatDescription?
    guard
      CMVideoFormatDescriptionCreateForImageBuffer(
        allocator: kCFAllocatorDefault,
        imageBuffer: pixelBuffer,
        formatDescriptionOut: &newPictureFormat) == noErr,
      let pictureFormat = newPictureFormat
    else { return }
    var timing = CMSampleTimingInfo(
      duration: .invalid,
      presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()),
      decodeTimeStamp: .invalid)
    var newSample: CMSampleBuffer?
    guard
      CMSampleBufferCreateReadyWithImageBuffer(
        allocator: kCFAllocatorDefault,
        imageBuffer: pixelBuffer,
        formatDescription: pictureFormat,
        sampleTiming: &timing,
        sampleBufferOut: &newSample) == noErr,
      let sample = newSample
    else { return }

    if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true),
      CFArrayGetCount(attachments) > 0
    {
      let dictionary = unsafeBitCast(
        CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
      CFDictionarySetValue(
        dictionary,
        Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
        Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    }

    showLocked(.video)
    if displayLayer.status == .failed {
      displayLayer.flush()
    }
    if !displayLayer.isReadyForMoreMediaData {
      // Newest wins: discard what the layer has not shown yet.
      displayLayer.flush()
    }
    displayLayer.enqueue(sample)
    notePictureLocked()
  }

  private func showLocked(_ newMode: ScreenMode) {
    if mode == newMode { return }
    mode = newMode
    firstPicturePending = true
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    displayLayer.isHidden = newMode != .video
    imageLayer.isHidden = newMode != .image
    if newMode == .video {
      imageLayer.contents = nil
    } else {
      displayLayer.flushAndRemoveImage()
    }
    CATransaction.commit()
  }

  private func clearLayersLocked() {
    mode = .none
    lastWidth = 0
    lastHeight = 0
    firstPicturePending = true
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    displayLayer.flushAndRemoveImage()
    displayLayer.isHidden = true
    imageLayer.contents = nil
    imageLayer.isHidden = true
    CATransaction.commit()
  }

  private func makeImage(width: Int, height: Int, rgba: Data) -> CGImage? {
    guard let provider = CGDataProvider(data: rgba as CFData) else { return nil }
    return CGImage(
      width: width,
      height: height,
      bitsPerComponent: 8,
      bitsPerPixel: 32,
      bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
      provider: provider,
      decode: nil,
      shouldInterpolate: false,
      intent: .defaultIntent)
  }

  private func notePictureLocked() {
    let now = DispatchTime.now().uptimeNanoseconds
    if lastPictureNanos != 0 && now &- lastPictureNanos > pictureGapNanos {
      firstPicturePending = true
    }
    lastPictureNanos = now
    if firstPicturePending {
      firstPicturePending = false
      onFirstPicture?()
    }
  }

  /// Asks the computer for a key frame / full update, off the calling thread and rate limited
  /// unless `force`.
  private func requestRefreshLocked(force: Bool) {
    guard let id = connectionId else { return }
    let now = DispatchTime.now().uptimeNanoseconds
    if !force && lastRefreshNanos != 0 && now &- lastRefreshNanos < refreshSpacingNanos {
      return
    }
    lastRefreshNanos = now
    DispatchQueue.global(qos: .userInitiated).async {
      ScreenHub.shared.refresh(id)
    }
  }
}
