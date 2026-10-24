import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Platform, Pressable, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { KeyRow } from "@/components/terminal/key-row";
import { PromptComposer } from "@/components/terminal/prompt-composer";
import { TerminalView } from "@/components/terminal/terminal-view";
import { Text } from "@/components/ui";
import { diffInput } from "@/lib/screen-keys";
import { applyModifiers, KEY_DATA, type Modifiers } from "@/lib/terminal-keys";
import { DEFAULT_FONT_SIZE, fitFontSize } from "@/lib/terminal-metrics";
import { loadFontSize, saveFontSize } from "@/lib/terminal-prefs";
import type { TerminalScreen } from "@/lib/terminal-screen";

// The soft keyboard's hidden input always holds this sentinel so Backspace has
// something to delete (Android fires no change on an empty field).
const SENTINEL = "\u200b\u200b";
/** Rows of scrollback fetched when the reader scrolls up (the bridge caps it at 3000). */
const HISTORY_LINES = 2000;

interface NativeTerminalProps {
  paneId: string;
  screen: TerminalScreen;
  /** Keyboard is ours and the socket is open. */
  canType: boolean;
  /** Agent panes get the prompt composer. */
  isAgent: boolean;
  sendInput: (data: string) => boolean;
  sendPaste: (text: string, submit: boolean) => boolean;
  /** Ask the bridge for scrollback rows (the live stream has the visible grid only). */
  requestHistory: (lines: number) => void;
  /** Take the keyboard back after another viewer took it; absent while disconnected. */
  onClaimKeyboard?: () => void;
}

/**
 * Native terminal: the rendered screen, a hidden input that owns the OS
 * keyboard, the extra-key row and (for agent panes) the prompt composer.
 */
export function NativeTerminal({
  paneId,
  screen,
  canType,
  isAgent,
  sendInput,
  sendPaste,
  requestHistory,
  onClaimKeyboard,
}: NativeTerminalProps) {
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [width, setWidth] = useState(0);
  const { cols } = useSyncExternalStore(screen.subscribe, screen.getState);
  const [mods, setMods] = useState<Modifiers>({ ctrl: false, alt: false });
  const input = useRef<TextInput>(null);

  // The saved size applies once; the user's pinch wins from then on.
  const touched = useRef(false);
  useEffect(() => {
    void loadFontSize().then((saved) => {
      if (saved && !touched.current) setFontSize(saved);
    });
  }, []);

  const resize = useCallback((size: number) => {
    touched.current = true;
    setFontSize(size);
  }, []);

  const fit = fitFontSize(width, cols);

  /** Send data with any armed Ctrl/Alt folded in, then disarm them. */
  const send = (data: string) => {
    sendInput(mods.ctrl || mods.alt ? applyModifiers(data, mods) : data);
    if (mods.ctrl || mods.alt) setMods({ ctrl: false, alt: false });
  };

  const onType = (next: string) => {
    // react-native-web has no setNativeProps; its controlled `value` already snaps back.
    if (Platform.OS !== "web") input.current?.setNativeProps({ text: SENTINEL });
    const { deleted, inserted } = diffInput(SENTINEL, next);
    for (let i = 0; i < deleted; i++) sendInput(KEY_DATA.backspace);
    if (inserted) send(inserted);
  };

  const focusKeyboard = useCallback(() => input.current?.focus(), []);

  const toggleKeyboard = () => {
    if (input.current?.isFocused()) input.current.blur();
    else input.current?.focus();
  };

  const paste = async () => {
    const text = (await Clipboard.getStringAsync()).replace(/\r\n?/g, "\n");
    if (!text) return;
    if (!text.includes("\n")) {
      send(text);
      return;
    }
    // A newline runs whatever precedes it: confirm before pasting a block.
    Alert.alert("Paste multiple lines?", `${text.split("\n").length} lines will go to the pane.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Paste", onPress: () => sendPaste(text, false) },
    ]);
  };

  const sendPrompt = (text: string) =>
    text.includes("\n") ? sendPaste(text, true) : sendInput(`${text}${KEY_DATA.enter}`);

  return (
    <View style={styles.fill}>
      <View style={styles.fill} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <TerminalView
          onScrollBack={() => requestHistory(HISTORY_LINES)}
          screen={screen}
          fontSize={fontSize}
          onFontSize={resize}
          onFontSizeCommit={(size) => void saveFontSize(size)}
          onTapText={canType ? focusKeyboard : noop}
        />
        {Math.abs(fit - fontSize) >= 0.5 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fit terminal width"
            onPress={() => {
              resize(fit);
              void saveFontSize(fit);
            }}
            style={styles.fit}
          >
            <Text style={styles.fitText}>Fit width</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Hidden input that owns the OS keyboard; typed text is forwarded as input frames. */}
      <TextInput
        ref={input}
        value={SENTINEL}
        onChangeText={onType}
        onSubmitEditing={() => send(KEY_DATA.enter)}
        submitBehavior="submit"
        editable={canType}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType={Platform.OS === "android" ? "visible-password" : "default"}
        caretHidden
        style={styles.hiddenInput}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />

      {isAgent ? (
        <PromptComposer
          paneId={paneId}
          enabled={canType}
          onSend={sendPrompt}
          onClaim={onClaimKeyboard}
        />
      ) : null}
      <KeyRow
        compact={isAgent}
        enabled={canType}
        mods={mods}
        onToggleMod={(mod) => setMods((m) => ({ ...m, [mod]: !m[mod] }))}
        onKey={send}
        onPaste={() => void paste()}
        onToggleKeyboard={toggleKeyboard}
      />
    </View>
  );
}

const noop = () => {};

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0, left: 0, bottom: 0 },
  fit: {
    position: "absolute",
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  fitText: { fontSize: theme.fontSize.xs, fontFamily: theme.fonts.bold, color: "#e5e5e5" },
}));
