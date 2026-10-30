import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { ActivityIndicator, Alert, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MicButton } from "@/components/mic-button";
import { IconButton } from "@/components/ui";
import { api } from "@/lib/api";
import { directManager } from "@/lib/direct";
import { describeDirectError } from "@/lib/direct/describe";
import { pasteImageDirect } from "@/lib/direct/paste-image";
import type { PaneTransport } from "@/lib/direct/transport-choice";
import { insertedText, insertPath } from "@/lib/terminal-keys";

/** What the pane screen does to the draft on a chord: Ctrl+A selects all of it. */
export interface PromptComposerHandle {
  selectAll: () => void;
  isFocused: () => boolean;
}

interface PromptComposerProps {
  ref?: Ref<PromptComposerHandle>;
  paneId: string;
  enabled: boolean;
  /** The road the pane is on: images go to the computer by the same road. */
  transport: PaneTransport;
  /** Deliver the prompt (text, then Enter); false when it could not be sent, so the draft stays. */
  onSend: (text: string) => boolean;
  /** Present when another viewer holds the keyboard: tapping the field takes it back. */
  onClaim?: () => void;
  /**
   * Ctrl or Alt is latched on the key row: the next typed character is a chord for the terminal,
   * so it is taken out of the draft and handed here instead of being inserted.
   */
  modsLatched?: boolean;
  onLatchedKey?: (typed: string) => void;
}

/**
 * Prompt bar for agent panes: a multiline draft (dictation-capable) and a Send
 * that types the text and presses Enter. Return inserts a newline. The image
 * button takes an image from the phone clipboard, saves it on the pane's
 * machine and inserts its path, so the agent can open it (the web composer
 * does the same for pasted and dropped images).
 */
export function PromptComposer({
  ref,
  paneId,
  transport,
  enabled,
  onSend,
  onClaim,
  modsLatched,
  onLatchedKey,
}: PromptComposerProps) {
  const { theme } = useUnistyles();
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const caret = useRef(0);
  const field = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({
    selectAll: () => field.current?.setSelection(0, text.length),
    isFocused: () => field.current?.isFocused() ?? false,
  }));
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
      const direct = transport === "direct";
      const { path } = direct
        ? await pasteImageDirect(directManager.getSnapshot().connection, paneId, base64)
        : await api.panePasteImage(
            paneId,
            Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)).buffer,
            "image/png",
          );
      setText((current) => {
        const next = insertPath(current, Math.min(caret.current, current.length), path);
        caret.current = next.caret;
        return next.text;
      });
      void Haptics.selectionAsync().catch(() => {});
    } catch (error) {
      Alert.alert(
        "Couldn't attach the image",
        transport === "direct"
          ? describeDirectError(error)
          : error instanceof Error
            ? error.message
            : undefined,
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.bar}>
      <View style={styles.box}>
        <TextInput
          ref={field}
          value={text}
          onChangeText={(next) => {
            const typed = modsLatched ? insertedText(text, next) : null;
            if (typed !== null) {
              // A chord for the terminal, not text: put the draft back as it was.
              field.current?.setNativeProps({ text });
              onLatchedKey?.(typed);
              return;
            }
            setText(next);
            caret.current = next.length;
          }}
          onSelectionChange={(e) => {
            caret.current = e.nativeEvent.selection.end;
          }}
          editable={enabled}
          onPressIn={enabled ? undefined : onClaim}
          multiline
          placeholder={
            enabled ? "Message the agent…" : onClaim ? "Tap to take the keyboard" : "Read-only"
          }
          placeholderTextColor={theme.colors.mutedForeground}
          style={styles.input}
          accessibilityLabel="Prompt"
          autoCapitalize="sentences"
        />
        <View style={styles.toolbar}>
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
          <View style={styles.grow} />
          <IconButton icon="send" label="Send prompt" onPress={send} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.background,
  },
  // The draft spans the full width; the actions sit on a slim row under it,
  // so long prompts wrap at the screen edge instead of half of it.
  box: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
  },
  input: {
    minHeight: 40,
    maxHeight: 160,
    paddingHorizontal: theme.spacing.md,
    paddingTop: 10,
    paddingBottom: 4,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontFamily: theme.fonts.regular,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    paddingBottom: theme.spacing.xs,
  },
  grow: { flex: 1 },
  spinner: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
}));
