import { requireOptionalNativeModule } from "expo-modules-core";
import { useEffect, useRef } from "react";

import type { KeyChord } from "@/lib/terminal-keys";

interface NativeAturKeys {
  setCapture(on: boolean): void;
  addListener(event: "key", listener: (chord: KeyChord) => void): { remove(): void };
}

/** Android and iOS, and only in binaries built with the module (an OTA update can run on older ones). */
const native = requireOptionalNativeModule<NativeAturKeys>("AturKeys");

/**
 * While `active`, hardware key chords with Ctrl, Alt or Meta held (and, on iOS, the navigation
 * keys: arrows, Esc, Tab, Home/End, Page Up/Down) are taken from the focused text field and
 * handed to `onChord`. Without the native module nothing is captured.
 */
export function useHardwareChords(active: boolean, onChord: (chord: KeyChord) => void): void {
  const latest = useRef(onChord);
  latest.current = onChord;
  useEffect(() => {
    if (!native || !active) return;
    const subscription = native.addListener("key", (chord) => latest.current(chord));
    native.setCapture(true);
    return () => {
      native.setCapture(false);
      subscription.remove();
    };
  }, [active]);
}
