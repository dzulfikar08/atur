import { memo, useMemo } from "react";
import { Platform, Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { chunkSpan, parseRow, resolveColors, rowText, type Span } from "@/lib/ansi";
import { linkAtCell } from "@/lib/terminal-links";
import { TERMINAL_PALETTE } from "@/components/terminal/palette";

export interface RowMetrics {
  fontSize: number;
  lineHeight: number;
  cellWidth: number;
}

// react-native-web collapses whitespace-only spans under numberOfLines=1 (nowrap)
// and an inline style is what beats its atomic class; native keeps the spaces anyway.
const KEEP_SPACES = Platform.OS === "web" ? ({ whiteSpace: "pre" } as object) : null;

interface TerminalRowProps extends RowMetrics {
  line: string;
  /** Tap: `url` is the link under the finger, or null for plain text. */
  onTap: (url: string | null) => void;
  /** Long-press: open the text selector. */
  onLongPress: () => void;
}

function spanStyle(span: Span, metrics: RowMetrics) {
  const { color, backgroundColor } = resolveColors(span, TERMINAL_PALETTE);
  return [
    styles.text,
    {
      fontSize: metrics.fontSize,
      lineHeight: metrics.lineHeight,
      color,
      ...(backgroundColor ? { backgroundColor } : null),
    },
    KEEP_SPACES,
    span.bold && styles.bold,
    span.italic && styles.italic,
    span.underline && styles.underline,
  ];
}

/**
 * One terminal row. Memoised on the raw line plus metrics, so a diff frame
 * re-renders only the rows whose text changed.
 */
export const TerminalRow = memo(function TerminalRow({
  line,
  fontSize,
  lineHeight,
  cellWidth,
  onTap,
  onLongPress,
}: TerminalRowProps) {
  const row = useMemo(() => parseRow(line), [line]);
  const metrics = { fontSize, lineHeight, cellWidth };

  const press = (event: GestureResponderEvent) => {
    // react-native-web delivers the DOM click, which carries offsetX instead of locationX.
    const touch: { locationX?: number; offsetX?: number } = event.nativeEvent;
    const x = touch.locationX ?? touch.offsetX ?? Number.NaN;
    onTap(linkAtCell(rowText(row), Math.floor(x / cellWidth)));
  };

  return (
    <Pressable
      onPress={press}
      onLongPress={onLongPress}
      delayLongPress={450}
      style={{ height: lineHeight }}
    >
      {/* Touches resolve to the Pressable itself, so locationX is relative to the row. */}
      <View pointerEvents="none" style={styles.line}>
        {row.needsGrid ? (
          // Double-width glyphs from a fallback font are not exactly two cells wide, and icon
          // glyphs come from the symbols font, so every chunk is pinned to its cell count to keep
          // columns true.
          row.spans.flatMap((span, s) =>
            chunkSpan(span).map((chunk, c) => (
              <Text
                key={`${s}:${c}`}
                numberOfLines={1}
                style={[
                  spanStyle(span, metrics),
                  chunk.icon && styles.icon,
                  { width: chunk.cells * cellWidth },
                ]}
              >
                {chunk.text}
              </Text>
            )),
          )
        ) : (
          <Text
            numberOfLines={1}
            ellipsizeMode="clip"
            style={[styles.text, { fontSize, lineHeight }, KEEP_SPACES]}
          >
            {row.spans.length === 0
              ? " "
              : row.spans.map((span, s) => (
                  <Text key={s} style={spanStyle(span, metrics)}>
                    {span.text}
                  </Text>
                ))}
          </Text>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  line: { flexDirection: "row" },
  text: {
    fontFamily: theme.fonts.mono,
    color: TERMINAL_PALETTE.foreground,
    includeFontPadding: false,
    letterSpacing: 0,
  },
  bold: { fontFamily: theme.fonts.monoBold },
  italic: { fontStyle: "italic" },
  // JetBrains Mono stays primary; icon glyphs (Nerd Font private-use area) come from the symbols font.
  icon: { fontFamily: theme.fonts.symbols, fontWeight: "normal" },
  underline: { textDecorationLine: "underline" },
}));
