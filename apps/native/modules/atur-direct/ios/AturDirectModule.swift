import ExpoModulesCore
import Foundation

private let unknownConnection =
  #"{"error":{"code":"Disconnected","reason":"unknown connection"}}"#

// Asks the connection for a key frame / full update (used by the screen view).
private func screenRefresher(_ direct: Direct) -> @Sendable () -> Void {
  return { [weak direct] in
    _ = direct?.fire(method: "screenRefresh", argsJson: "{}")
  }
}

private func internalError(_ reason: String) -> String {
  let payload: [String: Any] = ["error": ["code": "Internal", "reason": reason]]
  if let data = try? JSONSerialization.data(withJSONObject: payload),
    let text = String(data: data, encoding: .utf8)
  {
    return text
  }
  return #"{"error":{"code":"Internal","reason":"unknown"}}"#
}

private final class MessageForwarder: DirectListener {
  private weak var module: AturDirectModule?
  private let connectionId: String

  init(module: AturDirectModule, connectionId: String) {
    self.module = module
    self.connectionId = connectionId
  }

  func onMessage(json: String) {
    module?.sendEvent("message", ["connection": connectionId, "json": json])
  }
}

public final class AturDirectModule: Module {
  private let lock = NSLock()
  private var connections: [String: Direct] = [:]
  private let workerQueue = DispatchQueue(label: "com.diatur.direct.worker", attributes: .concurrent)
  private let callQueue = DispatchQueue(label: "com.diatur.direct.call")
  // Scrollback reads are many page round trips on the computer: on their own queue, so they never
  // hold up attach, detach, the session list or the latency ping.
  private let historyQueue = DispatchQueue(label: "com.diatur.direct.history")

  private func connection(_ id: String) -> Direct? {
    lock.lock()
    defer { lock.unlock() }
    return connections[id]
  }

  private func store(_ id: String, _ direct: Direct) -> Direct? {
    lock.lock()
    defer { lock.unlock() }
    return connections.updateValue(direct, forKey: id)
  }

  private func remove(_ id: String) -> Direct? {
    lock.lock()
    defer { lock.unlock() }
    return connections.removeValue(forKey: id)
  }

  private func removeAll() -> [Direct] {
    lock.lock()
    defer { lock.unlock() }
    let all = Array(connections.values)
    connections.removeAll()
    return all
  }

  public func definition() -> ModuleDefinition {
    Name("AturDirect")

    Constants {
      return ["screenH264": screenHardwareH264Available()]
    }

    Events("message")

    AsyncFunction("parseLink") { (link: String) -> String in
      return directParseLink(link: link)
    }.runOnQueue(workerQueue)

    AsyncFunction("pair") { (link: String, deviceName: String) -> String in
      return directPair(link: link, deviceName: deviceName)
    }.runOnQueue(workerQueue)

    AsyncFunction("connect") { [weak self] (id: String, credentialJson: String) -> String in
      guard let self else { return internalError("module released") }
      let direct = Direct(listener: MessageForwarder(module: self, connectionId: id))
      let answer = direct.connect(credentialJson: credentialJson)
      if answer.hasPrefix(#"{"ok""#) {
        direct.setScreenSink(sink: ScreenSinkForwarder(connectionId: id))
        ScreenHub.shared.setRefresh(id, screenRefresher(direct))
        self.store(id, direct)?.disconnect()
      } else {
        direct.disconnect()
      }
      return answer
    }.runOnQueue(workerQueue)

    AsyncFunction("call") {
      [weak self] (id: String, method: String, argsJson: String, promise: Promise) in
      guard let self else {
        promise.resolve(unknownConnection)
        return
      }
      (method == "history" ? self.historyQueue : self.callQueue).async {
        guard let direct = self.connection(id) else {
          promise.resolve(unknownConnection)
          return
        }
        promise.resolve(direct.call(method: method, argsJson: argsJson))
      }
    }

    Function("fire") { [weak self] (id: String, method: String, argsJson: String) -> String in
      guard let direct = self?.connection(id) else { return unknownConnection }
      return direct.fire(method: method, argsJson: argsJson)
    }

    AsyncFunction("disconnect") { [weak self] (id: String) in
      ScreenHub.shared.removeRefresh(id)
      self?.remove(id)?.disconnect()
    }.runOnQueue(workerQueue)

    OnDestroy { [weak self] in
      ScreenHub.shared.removeAllRefreshers()
      self?.removeAll().forEach { $0.disconnect() }
    }

    View(AturScreenView.self) {
      Events("onFirstPicture", "onDecoderError")

      Prop("connection") { (view: AturScreenView, connection: String?) in
        view.connectionId = connection
      }
    }
  }
}
