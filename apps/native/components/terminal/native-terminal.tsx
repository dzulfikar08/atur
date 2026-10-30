import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Platform, Pressable, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { KeyRow } from "@/components/terminal/key-row";
import { PromptComposer, type PromptComposerHandle } from "@/components/terminal/prompt-composer";
import { TerminalView } from "@/components/terminal/terminal-view";
import { Text } from "@/components/ui";
import type { PaneTransport } from "@/lib/direct/transport-choice";
import { useHardwareChords } from "@/lib/hardware-keys";
import { diffInput } from "@/lib/screen-keys";
import {
  applyModifiers,
  encodeChord,
  isSelectAll,
  KEY_DATA,
  type KeyChord,
  type Modifiers,
} from "@/lib/terminal-keys";
import { DEFAULT_FONT_SIZE, fitFontSize, gridForViewport } from "@/lib/terminal-metrics";
import { loadFontSize, saveFontSize } from "@/lib/terminal-prefs";
import type { TerminalScreen } from "@/lib/terminal-screen";

// The soft keyboard's hidden input always holds this sentinel so Backspace has
// something to delete (Android fires no change on an empty field).
const SENTINEL = "\u200b\u200b";

interface NativeTerminalProps {
  paneId: string;
  screen: TerminalScreen;
  /** The road the pane is on; the prompt composer saves images on the computer by it. */
  transport: PaneTransport;
  /** Keyboard is ours and the socket is open. */
  canType: boolean;
  /** Agent panes get the prompt composer. */
  isAgent: boolean;
  sendInput: (data: string) => boolean;
  sendPaste: (text: string, submit: boolean) => boolean;
  /** Take the keyboard back after another viewer took it; absent while disconnected. */
  onClaimKeyboard?: () => void;
  /** Lay the pane out at this grid (sent while we hold the keyboard). */
  requestResize: (cols: number, rows: number) => void;
  /** Long-press on the text: open the text selector. */
  onSelectText: () => void;
}

/**
 * Native terminal: the rendered screen, a hidden input that owns the OS
 * keyboard, the extra-key row and (for agent panes) the prompt composer.
 */
export function NativeTerminal({
  paneId,
  screen,
  transport,
  canType,
  isAgent,
  sendInput,
  sendPaste,
  onClaimKeyboard,
  requestResize,
  onSelectText,
}: NativeTerminalProps) {
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const width = box.width;
  // Only the width: the whole state changes with every frame, and the keyboard, the composer and
  // the key row have no business re-rendering ten times a second while an agent prints.
  const cols = useSyncExternalStore(screen.subscribe, () => screen.getState().cols);
  const [mods, setMods] = useState<Modifiers>({ ctrl: false, alt: false });
  const input = useRef<TextInput>(null);
  const composer = useRef<PromptComposerHandle>(null);

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

  // Ask for a pane exactly as big as this view, as Termius does by attaching at
  // the phone's size. Re-sent on rotation, pinch and every (re)connect, since
  // canType flips back to true then. The height is the tallest seen at this
  // width: the soft keyboard (and Android's suggestion strip coming and going)
  // only shortens the view, and resizing the pane for it made the agent redraw
  // its whole screen under the finger while scrolling. With the keyboard up the
  // list simply shows the pane's bottom rows.
  const fullHeight = useRef({ width: 0, height: 0 });
  if (fullHeight.current.width !== box.width) fullHeight.current = { width: box.width, height: 0 };
  fullHeight.current.height = Math.max(fullHeight.current.height, box.height);
  const paneHeight = fullHeight.current.height;
  useEffect(() => {
    if (!canType || box.width <= 0 || paneHeight <= 0) return;
    const grid = gridForViewport(box.width, paneHeight, fontSize);
    requestResize(grid.cols, grid.rows);
  }, [canType, box.width, paneHeight, fontSize, requestResize]);

  const loadMoreHistory = useCallback(() => screen.loadHistory(), [screen]);
  const loadOlderHistory = useCallback(() => screen.loadOlder(), [screen]);

  /** Send data with any armed Ctrl/Alt folded in, then disarm them. */
  const send = (data: string) => {
    sendInput(mods.ctrl || mods.alt ? applyModifiers(data, mods) : data);
    if (mods.ctrl || mods.alt) setMods({ ctrl: false, alt: false });
  };

  // Chords from a hardware keyboard (Ctrl/Alt/Meta held): control bytes and ESC prefixes go to the
  // pane, never into a text field. Ctrl+A in the prompt composer selects its draft instead.
  useHardwareChords(canType, (chord: KeyChord) => {
    if (isSelectAll(chord) && composer.current?.isFocused()) {
      composer.current.selectAll();
      return;
    }
    const data = encodeChord(chord);
    if (data !== null) sendInput(data);
  });

  // A character typed on the soft keyboard into the composer while Ctrl/Alt is latched on the key row.
  const onComposerLatchedKey = (typed: string) => {
    if (
      mods.ctrl &&
      !mods.alt &&
      isSelectAll({ key: typed, ctrl: true, alt: false, meta: false })
    ) {
      composer.current?.selectAll();
      setMods({ ctrl: false, alt: false });
      return;
    }
    send(typed);
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
      <View
        style={styles.fill}
        onLayout={(event) => {
          const { width: w, height: h } = event.nativeEvent.layout;
          setBox({ width: w, height: h });
        }}
      >
        <TerminalView
          onScrollBack={loadMoreHistory}
          onNearTop={loadOlderHistory}
          onSelectText={onSelectText}
          screen={screen}
          fontSize={fontSize}
          onFontSize={resize}
          onFontSizeCommit={(size) => void saveFontSize(size)}
          onTapText={canType ? focusKeyboard : noop}
        />
        {/* Only when the pane is wider than the view (another client sized it): a phone-sized pane already fits. */}
        {cols > gridForViewport(box.width, box.height, fontSize).cols &&
        Math.abs(fit - fontSize) >= 0.5 ? (
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
          ref={composer}
          modsLatched={mods.ctrl || mods.alt}
          onLatchedKey={onComposerLatchedKey}
          paneId={paneId}
          transport={transport}
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
