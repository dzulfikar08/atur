import { requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/** The module's native screen view (`AturScreenView`): draws the computer's newest picture. */
export interface AturScreenViewProps {
  /** The direct connection whose screen to draw (`DirectConnection.id`). */
  connection: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** The first picture was drawn after attaching or reopening. */
  onFirstPicture?: () => void;
  /** Hardware decoding failed (twice in a row, or could not start): reopen without H.264. */
  onDecoderError?: (event: { nativeEvent: { reason: string } }) => void;
}

let loaded: ComponentType<AturScreenViewProps> | null | undefined;

/**
 * The native view, or null in a build that does not have it (web, a binary from before the screen
 * view, an OTA bundle on an old binary). Resolved on first use so such builds still load the app.
 */
export function loadScreenView(): ComponentType<AturScreenViewProps> | null {
  if (loaded !== undefined) return loaded;
  try {
    // A missing view would only warn and then fail to render: look first.
    loaded = globalThis.expo?.getViewConfig("AturDirect", "AturScreenView")
      ? requireNativeView<AturScreenViewProps>("AturDirect", "AturScreenView")
      : null;
  } catch {
    loaded = null;
  }
  return loaded;
}
