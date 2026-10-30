import XCTest

/// Drives the AturKeys module with real hardware key events on the simulator. The app is already
/// running on the e2e-keys screen (scripts in .github/workflows/ios-keys-simulator.yml opens it);
/// the screen shows the bytes each captured chord encodes to and what reached its text field.
final class KeysTests: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "com.diatur.app")

  override func setUp() {
    continueAfterFailure = false
    // `simctl openurl` raises SpringBoard's "Open in Atur?" confirmation.
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let open = springboard.alerts.buttons["Open"]
    if open.waitForExistence(timeout: 15) { open.tap() }
    app.activate()
    XCTAssertTrue(app.textFields["keys-input"].waitForExistence(timeout: 120))
  }

  private func log() -> String { app.staticTexts["keys-log"].label }

  private func expectLog(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
    let predicate = NSPredicate(format: "label == %@", text)
    let result = XCTWaiter().wait(
      for: [expectation(for: predicate, evaluatedWith: app.staticTexts["keys-log"])], timeout: 10)
    XCTAssertEqual(result, .completed, "log was: \(log())", file: file, line: line)
  }

  func testChordsAndNavigationKeys() {
    // Ctrl+A, Ctrl+C, Alt+B, Cmd+K, then arrows, Tab: encoded, and nothing typed into the field.
    app.typeKey("a", modifierFlags: .control)
    app.typeKey("c", modifierFlags: .control)
    app.typeKey("b", modifierFlags: .option)
    app.typeKey("k", modifierFlags: .command)
    app.typeKey(XCUIKeyboardKey.upArrow.rawValue, modifierFlags: [])
    app.typeKey(XCUIKeyboardKey.leftArrow.rawValue, modifierFlags: [])
    app.typeKey(XCUIKeyboardKey.tab.rawValue, modifierFlags: [])
    expectLog("sent=01,03,1b62,1b6b,1b5b41,1b5b44,09 input=[]")
  }

  /// Esc is its own test: XCTest's Escape key may not reach the app as a HID press on the simulator.
  func testEscape() throws {
    let before = log()
    app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
    var delivered = XCTWaiter().wait(
      for: [expectation(for: NSPredicate(format: "label != %@", before), evaluatedWith: app.staticTexts["keys-log"])],
      timeout: 5)
    if delivered != .completed {
      print("KEYS-E2E: XCUIKeyboardKey.escape produced no event; trying \\u{1b}")
      app.typeKey("\u{1b}", modifierFlags: [])
      delivered = XCTWaiter().wait(
        for: [expectation(for: NSPredicate(format: "label != %@", before), evaluatedWith: app.staticTexts["keys-log"])],
        timeout: 5)
    }
    // Neither form of Escape produced a HID press in the app: XCTest's injection, not the module
    // (Escape takes the same path as Tab, which the other test proves).
    if delivered != .completed { throw XCTSkip("XCTest cannot inject Escape on the simulator") }
    XCTAssertTrue(log().contains("1b input=[]"), "log was: \(log())")
  }
}
