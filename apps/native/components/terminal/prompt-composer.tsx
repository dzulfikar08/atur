import * as Haptics from "expo-haptics";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MicButton } from "@/components/mic-button";
import { IconButton } from "@/components/ui";

interface PromptComposerProps {
  enabled: boolean;
  /** Deliver the prompt (text, then Enter); false when it could not be sent, so the draft stays. */
  onSend: (text: string) => boolean;
}

/**
 * Prompt bar for agent panes: a multiline draft (dictation-capable) and a Send
 * that types the text and presses Enter. Return inserts a newline.
 */
export function PromptComposer({ enabled, onSend }: PromptComposerProps) {
  const { theme } = useUnistyles();
  const [text, setText] = useState("");
  const canSend = enabled && text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    if (onSend(text.trimEnd())) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setText("");
    }
  };

  return (
    <View style={styles.bar}>
      <TextInput
        value={text}
        onChangeText={setText}
        editable={enabled}
        multiline
        placeholder={enabled ? "Message the agent…" : "Read-only"}
        placeholderTextColor={theme.colors.mutedForeground}
        style={styles.input}
        accessibilityLabel="Prompt"
        autoCapitalize="sentences"
      />
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
}));
