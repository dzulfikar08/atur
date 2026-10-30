package com.diatur.keys

import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.Window
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hardware keyboard chords for the terminal. While capture is on, a key pressed with Ctrl, Alt
 * or Meta held is taken before the focused text field sees it (Android's EditText would run
 * select-all, copy or paste on it) and handed to JS as `key` events; JS decides what it means
 * (control bytes for the terminal, select-all in the prompt composer).
 */
class AturKeysModule : Module() {
  @Volatile private var capture = false
  private var tapped: Window? = null

  override fun definition() =
    ModuleDefinition {
      Name("AturKeys")

      Events("key")

      Function("setCapture") { on: Boolean ->
        capture = on
        if (on) install()
      }

      OnActivityEntersForeground { install() }

      OnDestroy { capture = false }
    }

  private fun install() {
    val window = appContext.currentActivity?.window ?: return
    if (tapped === window) return
    window.callback = KeyTap(window.callback)
    tapped = window
  }

  private fun chordOf(event: KeyEvent): Map<String, Any>? {
    val ctrl = event.isCtrlPressed
    // Left Alt only: the right one is AltGr on many layouts and types symbols.
    val alt = (event.metaState and KeyEvent.META_ALT_LEFT_ON) != 0
    val meta = event.isMetaPressed
    if (!ctrl && !alt && !meta) return null
    val key =
      if (event.keyCode == KeyEvent.KEYCODE_DEL) {
        "Backspace"
      } else {
        // The character the key types with only Shift applied (Ctrl+Shift+6 is "^").
        val shift = if (event.isShiftPressed) KeyEvent.META_SHIFT_ON else 0
        val code = event.getUnicodeChar(shift)
        if (code <= 0x20 && event.keyCode != KeyEvent.KEYCODE_SPACE) return null
        if (code and KeyCharacterMap.COMBINING_ACCENT != 0) return null
        String(Character.toChars(code))
      }
    return mapOf("key" to key, "ctrl" to ctrl, "alt" to alt, "meta" to meta)
  }

  private inner class KeyTap(private val base: Window.Callback) : Window.Callback by base {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      if (capture && event.action == KeyEvent.ACTION_DOWN) {
        val chord = chordOf(event)
        if (chord != null) {
          sendEvent("key", chord)
          return true
        }
      }
      return base.dispatchKeyEvent(event)
    }
  }
}
