import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * Lifts its content above the soft keyboard on iOS (padding); Android resizes
 * the window itself. Elsewhere (react-native-web) it is a plain View, since
 * KeyboardAvoidingView drops flex styles there.
 *
 * `fill` takes the remaining space of its parent; `dock` pins to the bottom
 * edge over sibling content (an accessory row floating above a full-bleed view).
 */
export function KeyboardFrame({
  variant,
  children,
}: {
  variant: "fill" | "dock";
  children: ReactNode;
}) {
  const style = variant === "fill" ? styles.fill : styles.dock;
  return Platform.OS === "ios" ? (
    <KeyboardAvoidingView behavior="padding" style={style}>
      {children}
    </KeyboardAvoidingView>
  ) : (
    <View style={style}>{children}</View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
