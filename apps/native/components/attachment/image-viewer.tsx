import { useState } from "react";
import { ActivityIndicator, Image, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { assetSource } from "@/lib/api";
import type { AttachmentRef } from "@/lib/attachment-file";

/**
 * Full-screen image with pinch-to-zoom. `maximumZoomScale` is iOS-only (the
 * Android ScrollView ignores it), so Android shows the image fit to the screen.
 */
export function ImageViewer({ att }: { att: AttachmentRef }) {
  const { theme } = useUnistyles();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  return (
    <View style={styles.wrap}>
      <ScrollView
        style={styles.flex}
        onLayout={(e) => setBox(e.nativeEvent.layout)}
        maximumZoomScale={5}
        minimumZoomScale={1}
        bouncesZoom
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {box.width > 0 ? (
          <Image
            source={assetSource(att.url)}
            accessibilityLabel={att.name}
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            onLoad={() => setState("ready")}
            onError={() => setState("failed")}
            style={{ width: box.width, height: box.height }}
          />
        ) : null}
      </ScrollView>
      {state === "loading" ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={theme.colors.mutedForeground} />
        </View>
      ) : null}
      {state === "failed" ? (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.failed}>
            {"Can't preview this image here. Use Share to open it in another app."}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  failed: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, textAlign: "center" },
}));
