import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { HtmlView } from "@/components/html-view";
import { Button, Text } from "@/components/ui";
import { parseRow, rowText } from "@/lib/ansi";
import type { ScreenState, TerminalScreen } from "@/lib/terminal-screen";

/** Plain text of the pane: scrollback, then the screen, trailing blank rows dropped. */
export function paneText(state: Pick<ScreenState, "history" | "lines">): string {
  const rows = [...state.history, ...state.lines].map((row) => rowText(parseRow(row)).trimEnd());
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows.join("\n");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A page with the text in a <pre>: the WebView gives native selection with
 * handles across lines on iOS and Android (React Native's Text cannot select a
 * range on iOS). Opens scrolled to the bottom, where the newest output is.
 */
function selectionPage(text: string, colors: { bg: string; fg: string; sel: string }): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4">
<style>
html,body{margin:0;background:${colors.bg};color:${colors.fg}}
pre{margin:0;padding:12px 12px 40px;font:13px/1.45 ui-monospace,Menlo,"JetBrains Mono",monospace;white-space:pre-wrap;word-break:break-word;-webkit-user-select:text;user-select:text}
::selection{background:${colors.sel}}
</style></head><body><pre>${escapeHtml(text)}</pre>
<script>window.scrollTo(0,document.body.scrollHeight);</script></body></html>`;
}

/** Full-screen, selectable copy of the pane's text, with Copy all. */
export function SelectTextSheet({
  visible,
  screen,
  onClose,
}: {
  visible: boolean;
  screen: TerminalScreen;
  onClose: () => void;
}) {
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const state = useSyncExternalStore(screen.subscribe, screen.getState);
  // Snapshot on open, and again when scrollback lands, never on live output: new
  // lines must not reflow the text under a selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const text = useMemo(
    () => (visible ? paneText(screen.getState()) : ""),
    [visible, state.history],
  );
  const html = useMemo(
    () =>
      selectionPage(text, {
        bg: theme.colors.background,
        fg: theme.colors.foreground,
        sel: theme.colors.accent,
      }),
    [text, theme.colors.background, theme.colors.foreground, theme.colors.accent],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Select text</Text>
          <Text style={styles.hint}>Long-press to select, drag the handles, then Copy.</Text>
        </View>
        <HtmlView html={html} onMessage={() => {}} style={styles.page} />
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              variant="secondary"
              label={copied ? "Copied" : "Copy all"}
              onPress={() => {
                void Clipboard.setStringAsync(text).then(() => {
                  setCopied(true);
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                    () => {},
                  );
                  setTimeout(() => setCopied(false), 1400);
                });
              }}
            />
          </View>
          <View style={styles.flex}>
            <Button label="Done" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.hairline,
  },
  title: { fontSize: theme.fontSize.lg, fontFamily: theme.fonts.bold },
  hint: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  page: { flex: 1, backgroundColor: theme.colors.background },
  actions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  flex: { flex: 1 },
}));
