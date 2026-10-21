import "@/unistyles";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AttachmentViewer } from "@/components/attachment/viewer";
import { useAttachmentActions } from "@/components/attachment/use-attachment-actions";
import { ErrorNote, IconButton } from "@/components/ui";
import type { AttachmentRef } from "@/lib/attachment-file";
import { fileKind } from "@/lib/file-kind";

/**
 * Attachment viewer. Params come from the issue screen's attachment rows:
 * `url` (asset path), `name`, `type` (MIME, may be empty), `size` (bytes, may be empty).
 */
export default function AttachmentScreen() {
  const { theme } = useUnistyles();
  const params = useLocalSearchParams<{ url: string; name: string; type: string; size: string }>();
  const att = useMemo<AttachmentRef>(() => {
    const size = Number(params.size);
    const name = params.name || "Attachment";
    const type = params.type ?? "";
    return {
      url: params.url,
      name,
      // Android viewers only match a real PDF type, not application/octet-stream.
      type: fileKind(type, name) === "pdf" ? "application/pdf" : type,
      size: params.size && Number.isFinite(size) ? size : null,
    };
  }, [params.url, params.name, params.type, params.size]);
  const actions = useAttachmentActions(att);
  const android = Platform.OS === "android";

  const spinner = <ActivityIndicator color={theme.colors.foreground} />;
  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: att.name,
          headerRight: () => (
            <View style={styles.headerActions}>
              {android ? (
                actions.open.isPending ? (
                  spinner
                ) : (
                  <IconButton
                    icon="open-outline"
                    label="Open in another app"
                    onPress={() => actions.open.mutate()}
                  />
                )
              ) : null}
              {actions.share.isPending ? (
                spinner
              ) : (
                <IconButton
                  icon={android ? "share-social-outline" : "share-outline"}
                  label={android ? "Share" : "Share or open in…"}
                  onPress={() => actions.share.mutate()}
                />
              )}
            </View>
          ),
        }}
      />
      <View style={styles.flex}>
        <AttachmentViewer att={att} actions={actions} />
      </View>
      {actions.open.error || actions.share.error ? (
        <View style={styles.errorBar}>
          <ErrorNote error={actions.open.error ?? actions.share.error} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  errorBar: {
    padding: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.background,
  },
}));
