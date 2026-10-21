import { Ionicons } from "@expo/vector-icons";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { KIND_ICON } from "@/components/attachment/kind-icon";
import { Text } from "@/components/ui";
import { assetSource } from "@/lib/api";
import type { AttachmentRef } from "@/lib/attachment-file";

/**
 * Video and audio through expo-video: AVPlayer / ExoPlayer stream from the
 * auth-checked asset URL (the bearer header rides along, and the server's Range
 * support lets them seek). The hook releases the player on unmount.
 */
export function MediaViewer({ att, audio }: { att: AttachmentRef; audio: boolean }) {
  const { theme } = useUnistyles();
  const { uri, headers } = assetSource(att.url);
  const player = useVideoPlayer({ uri, headers }, (p) => {
    p.loop = false;
  });
  const { status, error } = useEvent(player, "statusChange", { status: player.status });

  return (
    <View style={styles.wrap}>
      {audio ? (
        <View style={styles.audioHead}>
          <Ionicons name={KIND_ICON.audio} size={72} color={theme.colors.mutedForeground} />
          <Text style={styles.name} selectable>
            {att.name}
          </Text>
        </View>
      ) : null}
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: !audio }}
        allowsPictureInPicture={false}
        style={audio ? styles.audioView : styles.flex}
      />
      {status === "error" ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error?.message ?? "Couldn't play this file. Use Share to open it in another app."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  audioHead: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  audioView: { height: 120 },
  name: { fontSize: theme.fontSize.lg, fontFamily: theme.fonts.bold, textAlign: "center" },
  error: {
    padding: theme.spacing.lg,
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    textAlign: "center",
  },
}));
