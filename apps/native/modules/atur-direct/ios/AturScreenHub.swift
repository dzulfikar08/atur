import Foundation

private struct WeakSurface {
  weak var surface: ScreenSurface?
}

/// Routes the screen media of each connection to the view currently attached to that connection id,
/// and lets that view ask the connection for a key frame / full update. Thread safe: the sinks call
/// in from core threads, the views from the main thread, the module from its worker queues.
final class ScreenHub: @unchecked Sendable {
  static let shared = ScreenHub()

  private let lock = NSLock()
  private var surfaces: [String: WeakSurface] = [:]
  private var refreshers: [String: @Sendable () -> Void] = [:]

  func attach(_ surface: ScreenSurface, to connectionId: String) {
    lock.lock()
    defer { lock.unlock() }
    surfaces[connectionId] = WeakSurface(surface: surface)
  }

  /// Removes the entry only when `surface` still owns it (a newer view may have taken over).
  func detach(_ surface: ScreenSurface, from connectionId: String) {
    lock.lock()
    defer { lock.unlock() }
    if let current = surfaces[connectionId], current.surface === surface || current.surface == nil {
      surfaces.removeValue(forKey: connectionId)
    }
  }

  func surface(for connectionId: String) -> ScreenSurface? {
    lock.lock()
    defer { lock.unlock() }
    return surfaces[connectionId]?.surface
  }

  func setRefresh(_ connectionId: String, _ refresh: @escaping @Sendable () -> Void) {
    lock.lock()
    defer { lock.unlock() }
    refreshers[connectionId] = refresh
  }

  func removeRefresh(_ connectionId: String) {
    lock.lock()
    defer { lock.unlock() }
    refreshers.removeValue(forKey: connectionId)
  }

  func removeAllRefreshers() {
    lock.lock()
    defer { lock.unlock() }
    refreshers.removeAll()
  }

  func refresh(_ connectionId: String) {
    lock.lock()
    let refresh = refreshers[connectionId]
    lock.unlock()
    refresh?()
  }
}

/// The per-connection `ScreenSink` handed to the core. Frames with no attached view are dropped.
final class ScreenSinkForwarder: ScreenSink {
  private let connectionId: String

  init(connectionId: String) {
    self.connectionId = connectionId
  }

  func onVideo(annexB: Data, reset: Bool) {
    ScreenHub.shared.surface(for: connectionId)?.receiveVideo(annexB, reset: reset)
  }

  func onFrame(width: UInt32, height: UInt32, rgba: Data) {
    ScreenHub.shared.surface(for: connectionId)?.receivePicture(
      width: Int(width), height: Int(height), rgba: rgba)
  }
}
