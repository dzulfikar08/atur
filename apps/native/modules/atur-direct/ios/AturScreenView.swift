import ExpoModulesCore
import UIKit

/// Shows the computer's screen for one Direct connection. Decoding and drawing live in
/// `ScreenSurface`; this view hosts its layer (a plain CALayer tree, so RN transforms on the view
/// scale and pan it) and attaches the surface to the connection while the view is in a window.
public final class AturScreenView: ExpoView {
  let onFirstPicture = EventDispatcher()
  let onDecoderError = EventDispatcher()

  private let surface = ScreenSurface()

  var connectionId: String? {
    didSet { syncAttachment() }
  }

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    layer.addSublayer(surface.rootLayer)
    surface.setHandlers(
      onFirstPicture: { [weak self] in
        Task { @MainActor in
          self?.onFirstPicture()
        }
      },
      onDecoderError: { [weak self] reason in
        Task { @MainActor in
          self?.onDecoderError(["reason": reason])
        }
      })
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    surface.layout(size: bounds.size)
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    syncAttachment()
  }

  /// Views that are recycled or off screen must not keep decoding: attached only while in a window.
  private func syncAttachment() {
    surface.attach(connectionId: window == nil ? nil : connectionId)
  }
}
