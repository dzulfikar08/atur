import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MicButton } from "@/components/mic-button";
import { IconButton } from "@/components/ui";
import { api } from "@/lib/api";
import { insertPath } from "@/lib/terminal-keys";

interface PromptComposerProps {
  paneId: string;
  enabled: boolean;
  /** Deliver the prompt (text, then Enter); false when it could not be sent, so the draft stays. */
  onSend: (text: string) => boolean;
}

/**
 * Prompt bar for agent panes: a multiline draft (dictation-capable) and a Send
 * that types the text and presses Enter. Return inserts a newline. The image
 * button takes an image from the phone clipboard, saves it on the pane's
 * machine and inserts its path, so the agent can open it (the web composer
 * does the same for pasted and dropped images).
 */
export function PromptComposer({ paneId, enabled, onSend }: PromptComposerProps) {
  const { theme } = useUnistyles();
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const caret = useRef(0);
  const canSend = enabled && !uploading && text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    if (onSend(text.trimEnd())) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setText("");
    }
  };

  const attachFromClipboard = async () => {
    if (!enabled || uploading) return;
    const image = (await Clipboard.hasImageAsync().catch(() => false))
      ? await Clipboard.getImageAsync({ format: "png" }).catch(() => null)
      : null;
    const base64 = image?.data.slice(image.data.indexOf(",") + 1);
    if (!base64) {
      Alert.alert(
        "No image to paste",
        "Copy a screenshot or photo first, then tap the image button.",
      );
      return;
    }
    setUploading(true);
    try {
      const png = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      const { path } = await api.panePasteImage(paneId, png.buffer, "image/png");
      setText((current) => {
        const next = insertPath(current, Math.min(caret.current, current.length), path);
        caret.current = next.caret;
        return next.text;
      });
      void Haptics.selectionAsync().catch(() => {});
    } catch (error) {
      Alert.alert("Couldn't attach the image", error instanceof Error ? error.message : undefined);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.bar}>
      <TextInput
        value={text}
        onChangeText={(next) => {
          setText(next);
          caret.current = next.length;
        }}
        onSelectionChange={(e) => {
          caret.current = e.nativeEvent.selection.end;
        }}
        editable={enabled}
        multiline
        placeholder={enabled ? "Message the agent…" : "Read-only"}
        placeholderTextColor={theme.colors.mutedForeground}
        style={styles.input}
        accessibilityLabel="Prompt"
        autoCapitalize="sentences"
      />
      {uploading ? (
        <View style={styles.spinner}>
          <ActivityIndicator color={theme.colors.foreground} />
        </View>
      ) : (
        <IconButton
          icon="image-outline"
          label="Paste image from clipboard"
          onPress={() => void attachFromClipboard()}
        />
      )}
      <MicButton value={text} onChangeText={setText} disabled={!enabled} />
      <IconButton icon="send" label="Send prompt" onPress={send} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.background,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingHorizontal: theme.spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontFamily: theme.fonts.regular,
  },
  spinner: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
}));
