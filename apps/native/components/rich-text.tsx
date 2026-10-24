import { useState } from "react";
import { router } from "expo-router";
import { Pressable, View, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { AuthedImage } from "@/components/authed-image";
import { Text } from "@/components/ui";
import { htmlToBlocks } from "@/lib/format";

/** Full-width image that keeps its aspect ratio once the size is known. */
export function InlineImage({ src }: { src: string }) {
  const [ratio, setRatio] = useState(4 / 3);
  const [failed, setFailed] = useState(false);
  if (failed) return <Text style={styles.broken}>Image unavailable</Text>;
  // Tap for the full-screen viewer (pinch to zoom on iOS; share / open in another app).
  const name = decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() || "Image");
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Open image"
      onPress={() =>
        router.push({
          pathname: "/attachment",
          params: { url: src, name, type: "image/*", size: "" },
        })
      }
    >
      <AuthedImage
        src={src}
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        onLoad={(e) => {
          // react-native-web omits nativeEvent.source.
          const size = e.nativeEvent?.source;
          if (size?.width && size?.height) setRatio(size.width / size.height);
        }}
        onError={() => setFailed(true)}
        style={[styles.image, { aspectRatio: ratio }]}
      />
    </Pressable>
  );
}

/** Issue description / comment HTML: paragraphs as text, <img> inline. */
export function RichText({ html, style }: { html: string | null | undefined; style?: TextStyle }) {
  return (
    <View style={styles.wrap}>
      {htmlToBlocks(html).map((block, i) =>
        block.type === "image" ? (
          <InlineImage key={i} src={block.src} />
        ) : (
          <Text key={i} style={style} selectable>
            {block.text}
          </Text>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.sm },
  image: {
    width: "100%",
    maxHeight: 420,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.muted,
  },
  broken: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
}));
