import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, View, type KeyboardEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * Keeps its content above the soft keyboard on iOS and Android by padding its
 * bottom by exactly the part of it the keyboard covers. Android no longer
 * resizes the window under edge-to-edge (mandatory from targetSdk 35), and
 * KeyboardAvoidingView measures its frame relative to its parent, so below a
 * header it under-lifts. Both the frame and the keyboard are measured here in
 * window coordinates. On react-native-web it is a plain View.
 *
 * `fill` takes the remaining space of its parent; `dock` pins to the bottom
 * edge over sibling content (an accessory row floating above a full-bleed view).
 * `floor` keeps at least that much padding while no keyboard is up (the system
 * navigation bar, for a screen that draws under it).
 */
export function KeyboardFrame({
  variant,
  floor = 0,
  children,
}: {
  variant: "fill" | "dock";
  floor?: number;
  children: ReactNode;
}) {
  const frame = useRef<View>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") return;
    // Padding sits inside the frame, so its window rect does not move with it.
    const show = (e: KeyboardEvent) =>
      frame.current?.measureInWindow((_x, y, _w, height) =>
        setInset(Math.max(0, Math.round(y + height - e.endCoordinates.screenY))),
      );
    const hide = () => setInset(0);
    const ios = Platform.OS === "ios";
    const subs = [
      Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", show),
      Keyboard.addListener(ios ? "keyboardWillChangeFrame" : "keyboardDidChangeFrame", show),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", hide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return (
    <View
      ref={frame}
      style={[
        variant === "fill" ? styles.fill : styles.dock,
        { paddingBottom: Math.max(inset, floor) },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
