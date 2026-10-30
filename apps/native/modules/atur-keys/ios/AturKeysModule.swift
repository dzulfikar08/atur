import ExpoModulesCore
import ObjectiveC
import UIKit

/// Hardware keyboard chords for the terminal, the iOS twin of the Android module (same `key`
/// event: `{ key, ctrl, alt, meta }`, plus `shift`).
///
/// While capture is on, a key pressed with Ctrl, Alt (left) or Cmd held, and the navigation keys
/// (arrows, Esc, Tab, Home/End, Page Up/Down, forward Delete), are taken before the focused text
/// field sees them and handed to JS, which decides what they mean (control bytes for the
/// terminal, readline edits in the prompt composer). UIKit delivers hardware keys to the
/// application as `UIPressesEvent`s through `UIApplication.sendEvent(_:)`; dropping the event
/// there keeps UITextField / UITextView and UIKeyCommand shortcuts (Cmd+A, Cmd+C, Cmd+V...) from
/// acting on it.
public final class AturKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AturKeys")

    Events("key")

    OnCreate {
      KeyTap.install()
    }

    Function("setCapture") { (on: Bool) in
      KeyTap.shared.emit = on ? { [weak self] chord in self?.sendEvent("key", chord) } : nil
    }

    OnDestroy {
      KeyTap.shared.emit = nil
    }
  }
}

/// What a press means to the terminal; pure so the policy reads in one place.
struct KeyPolicy {
  /// The `key` name JS expects for navigation keys; nil for keys that are not one.
  static func navigationName(_ usage: UIKeyboardHIDUsage) -> String? {
    switch usage {
    case .keyboardUpArrow: return "ArrowUp"
    case .keyboardDownArrow: return "ArrowDown"
    case .keyboardLeftArrow: return "ArrowLeft"
    case .keyboardRightArrow: return "ArrowRight"
    case .keyboardEscape: return "Escape"
    case .keyboardTab: return "Tab"
    case .keyboardHome: return "Home"
    case .keyboardEnd: return "End"
    case .keyboardPageUp: return "PageUp"
    case .keyboardPageDown: return "PageDown"
    case .keyboardDeleteForward: return "Delete"
    default: return nil
    }
  }

  /// Keys that move a caret in a multi-line text view (the prompt composer): left to the view
  /// when it has focus and no chord modifier is held. Esc is never in this set: it interrupts
  /// the agent.
  static func belongsToTextView(_ name: String) -> Bool {
    switch name {
    case "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Home", "End", "PageUp",
      "PageDown", "Delete":
      return true
    default: return false
    }
  }
}

final class KeyTap {
  static let shared = KeyTap()
  private static var installed = false

  /// Non-nil while capture is on.
  var emit: (([String: Any]) -> Void)?

  /// HID usages currently down, to tell left Alt from right Alt (AltGr types symbols).
  private var held = Set<UIKeyboardHIDUsage>()
  /// Presses whose "began" was taken: their repeats and "ended" are taken too.
  private var taken = Set<UIKeyboardHIDUsage>()

  static func install() {
    guard !installed else { return }
    installed = true
    let original = #selector(UIApplication.sendEvent(_:))
    let swizzled = #selector(UIApplication.atur_sendEvent(_:))
    guard let a = class_getInstanceMethod(UIApplication.self, original),
      let b = class_getInstanceMethod(UIApplication.self, swizzled)
    else { return }
    method_exchangeImplementations(a, b)
  }

  /// True when the event was taken and must not reach UIKit.
  func handle(_ event: UIPressesEvent) -> Bool {
    var swallow = false
    for press in event.allPresses {
      guard let key = press.key else { continue }
      let usage = key.keyCode
      switch press.phase {
      case .began, .changed:
        held.insert(usage)
        if let chord = chord(for: key), let emit = emit {
          taken.insert(usage)
          emit(chord)
          swallow = true
        } else if taken.contains(usage) {
          swallow = true
        }
      case .ended, .cancelled:
        held.remove(usage)
        if taken.remove(usage) != nil { swallow = true }
      default:
        if taken.contains(usage) { swallow = true }
      }
    }
    return swallow
  }

  private func chord(for key: UIKey) -> [String: Any]? {
    let flags = key.modifierFlags
    let ctrl = flags.contains(.control)
    // Left Alt only: the right one is AltGr on many layouts and types symbols.
    let rightOnly = held.contains(.keyboardRightAlt) && !held.contains(.keyboardLeftAlt)
    let alt = flags.contains(.alternate) && !rightOnly
    let meta = flags.contains(.command)
    let shift = flags.contains(.shift)
    let usage = key.keyCode

    let name: String
    if let nav = KeyPolicy.navigationName(usage) {
      if !ctrl && !alt && !meta && KeyPolicy.belongsToTextView(nav) && Self.textViewFocused() {
        return nil
      }
      name = nav
    } else if ctrl || alt || meta {
      if usage == .keyboardDeleteOrBackspace {
        name = "Backspace"
      } else {
        // The character the key types with only Shift applied (Ctrl+Shift+6 is "^").
        let chars = key.charactersIgnoringModifiers
        guard chars.unicodeScalars.count == 1, let scalar = chars.unicodeScalars.first,
          scalar.value >= 0x20, scalar.value != 0x7f,
          !(0xF700...0xF8FF).contains(scalar.value)  // function-key private-use range
        else { return nil }
        name = chars
      }
    } else {
      return nil
    }
    return ["key": name, "ctrl": ctrl, "alt": alt, "meta": meta, "shift": shift]
  }

  private static func textViewFocused() -> Bool {
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      for window in windowScene.windows where window.isKeyWindow {
        return firstResponder(in: window) is UITextView
      }
    }
    return false
  }

  private static func firstResponder(in view: UIView) -> UIView? {
    if view.isFirstResponder { return view }
    for sub in view.subviews {
      if let found = firstResponder(in: sub) { return found }
    }
    return nil
  }
}

extension UIApplication {
  @objc func atur_sendEvent(_ event: UIEvent) {
    if let presses = event as? UIPressesEvent, KeyTap.shared.handle(presses) { return }
    // After the exchange this calls the original sendEvent(_:).
    atur_sendEvent(event)
  }
}
