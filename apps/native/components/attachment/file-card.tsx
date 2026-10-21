import { Ionicons } from "@expo/vector-icons";
import { Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { KIND_ICON } from "@/components/attachment/kind-icon";
import type { AttachmentActions } from "@/components/attachment/use-attachment-actions";
import { Button, Text } from "@/components/ui";
import type { AttachmentRef } from "@/lib/attachment-file";
import { fileKind, formatBytes } from "@/lib/file-kind";

/**
 * The viewer for files the app can't render itself (and the fallback when it
 * can't render one in place): big kind icon, name, size, and the buttons that
 * hand the file to another app. Action errors surface in the screen's banner.
 */
export function FileCard({
  att,
  actions,
  message,
  openLabel,
}: {
  att: AttachmentRef;
  actions: AttachmentActions;
  /** Why the file isn't previewed, when that isn't obvious. */
  message?: string;
  /** Primary button label; defaults to the platform's open wording. */
  openLabel?: string;
}) {
  const { theme } = useUnistyles();
  const android = Platform.OS === "android";
  const kind = fileKind(att.type, att.name);
  const meta = [formatBytes(att.size), att.type].filter(Boolean).join(" · ");
  return (
    <View style={styles.wrap}>
      <Ionicons name={KIND_ICON[kind]} size={72} color={theme.colors.mutedForeground} />
      <Text style={styles.name} selectable>
        {att.name}
      </Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.actions}>
        <Button
          label={openLabel ?? (android ? "Open in app" : "Open in…")}
          icon="open-outline"
          loading={actions.open.isPending}
          onPress={() => actions.open.mutate()}
        />
        {android ? (
          <Button
            label="Share"
            icon="share-social-outline"
            variant="secondary"
            loading={actions.share.isPending}
            onPress={() => actions.share.mutate()}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  name: { fontSize: theme.fontSize.lg, fontFamily: theme.fonts.bold, textAlign: "center" },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, textAlign: "center" },
  message: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  actions: { alignSelf: "stretch", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
}));
