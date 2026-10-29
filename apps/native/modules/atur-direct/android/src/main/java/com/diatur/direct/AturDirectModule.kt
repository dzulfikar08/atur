package com.diatur.direct

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import org.json.JSONObject
import uniffi.atur_mobile.Direct
import uniffi.atur_mobile.DirectListener
import uniffi.atur_mobile.directPair
import uniffi.atur_mobile.directParseLink

private const val UNKNOWN_CONNECTION =
  """{"error":{"code":"Disconnected","reason":"unknown connection"}}"""

private fun internalError(e: Throwable): String {
  val reason = e.message ?: e.javaClass.name
  val error = JSONObject().put("code", "Internal").put("reason", reason)
  return JSONObject().put("error", error).toString()
}

private inline fun guarded(block: () -> String): String =
  try {
    block()
  } catch (e: Throwable) {
    internalError(e)
  }

class AturDirectModule : Module() {
  private val connections = ConcurrentHashMap<String, Direct>()
  private val workerDispatcher = Executors.newCachedThreadPool().asCoroutineDispatcher()
  private val callDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
  // Scrollback reads are many page round trips on the computer: on their own thread (and in their
  // own order), so they never hold up attach, detach, the session list or the latency ping.
  private val historyDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()

  override fun definition() =
    ModuleDefinition {
      Name("AturDirect")

      Events("message")

      AsyncFunction("parseLink") Coroutine { link: String ->
        withContext(workerDispatcher) { guarded { directParseLink(link) } }
      }

      AsyncFunction("pair") Coroutine { link: String, deviceName: String ->
        withContext(workerDispatcher) { guarded { directPair(link, deviceName) } }
      }

      AsyncFunction("connect") Coroutine { id: String, credentialJson: String ->
        withContext(workerDispatcher) {
          guarded {
            val listener =
              object : DirectListener {
                override fun onMessage(json: String) {
                  sendEvent("message", mapOf("connection" to id, "json" to json))
                }
              }
            val direct = Direct(listener)
            try {
              val answer = direct.connect(credentialJson)
              if (answer.startsWith("{\"ok\"")) {
                connections.put(id, direct)?.disconnect()
              } else {
                direct.disconnect()
              }
              answer
            } catch (e: Throwable) {
              runCatching { direct.disconnect() }
              throw e
            }
          }
        }
      }

      AsyncFunction("call") Coroutine { id: String, method: String, argsJson: String ->
        withContext(if (method == "history") historyDispatcher else callDispatcher) {
          guarded {
            val direct = connections[id]
            if (direct == null) UNKNOWN_CONNECTION else direct.call(method, argsJson)
          }
        }
      }

      Function("fire") { id: String, method: String, argsJson: String ->
        guarded {
          val direct = connections[id]
          if (direct == null) UNKNOWN_CONNECTION else direct.fire(method, argsJson)
        }
      }

      AsyncFunction("disconnect") Coroutine { id: String ->
        withContext(workerDispatcher) {
          connections.remove(id)?.let { runCatching { it.disconnect() } }
          Unit
        }
      }

      OnDestroy {
        val all = connections.values.toList()
        connections.clear()
        all.forEach { runCatching { it.disconnect() } }
      }
    }
}
