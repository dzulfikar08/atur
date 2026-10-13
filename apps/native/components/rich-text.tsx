import { useState } from "react";
import { Image, View, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { imageSource } from "@/lib/api";
import { htmlToBlocks } from "@/lib/format";

/** Full-width image that keeps its aspect ratio once the size is known. */
function InlineImage({ src }: { src: string }) {
  const [ratio, setRatio] = useState(4 / 3);
  const [failed, setFailed] = useState(false);
  if (failed) return <Text style={styles.broken}>Image unavailable</Text>;
  return (
    <Image
      source={imageSource(src)}
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
