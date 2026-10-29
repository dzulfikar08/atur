import ExpoModulesCore
import Foundation

private let unknownConnection =
  #"{"error":{"code":"Disconnected","reason":"unknown connection"}}"#

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
        self.store(id, direct)?.disconnect()
      } else {
        direct.disconnect()
      }
      return answer
    }.runOnQueue(workerQueue)

    AsyncFunction("call") { [weak self] (id: String, method: String, argsJson: String) -> String in
      guard let direct = self?.connection(id) else { return unknownConnection }
      return direct.call(method: method, argsJson: argsJson)
    }.runOnQueue(callQueue)

    Function("fire") { [weak self] (id: String, method: String, argsJson: String) -> String in
      guard let direct = self?.connection(id) else { return unknownConnection }
      return direct.fire(method: method, argsJson: argsJson)
    }

    AsyncFunction("disconnect") { [weak self] (id: String) in
      self?.remove(id)?.disconnect()
    }.runOnQueue(workerQueue)

    OnDestroy { [weak self] in
      self?.removeAll().forEach { $0.disconnect() }
    }
  }
}
