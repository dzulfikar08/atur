import { Ionicons } from "@expo/vector-icons";
import { lexer, type Token, type Tokens } from "marked";
import { Fragment, useMemo, type ReactNode } from "react";
import { Linking, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { InlineImage } from "@/components/rich-text";
import { Mono, Text } from "@/components/ui";
import { decodeEntities, imageTarget, linkTarget, splitInlineImages } from "@/lib/markdown";

// Renders `marked.lexer()` tokens as native components. No HTML is ever
// produced or injected: raw HTML in the source shows as literal text.

/** Inline tokens as the children of a <Text>. */
function renderInline(tokens: Token[]): ReactNode[] {
  return tokens.map((token, i) => {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        return t.tokens?.length ? (
          <Fragment key={i}>{renderInline(t.tokens)}</Fragment>
        ) : (
          decodeEntities(t.text)
        );
      }
      case "escape":
        return (token as Tokens.Escape).text;
      case "strong":
        return (
          <Text key={i} style={styles.strong}>
            {renderInline((token as Tokens.Strong).tokens)}
          </Text>
        );
      case "em":
        return (
          <Text key={i} style={styles.em}>
            {renderInline((token as Tokens.Em).tokens)}
          </Text>
        );
      case "del":
        return (
          <Text key={i} style={styles.del}>
            {renderInline((token as Tokens.Del).tokens)}
          </Text>
        );
      case "codespan":
        return (
          <Mono key={i} style={styles.codespan}>
            {(token as Tokens.Codespan).text}
          </Mono>
        );
      case "link": {
        const t = token as Tokens.Link;
        const target = linkTarget(t.href);
        return target ? (
          <Text
            key={i}
            style={styles.link}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(target).catch(() => {})}
          >
            {renderInline(t.tokens)}
          </Text>
        ) : (
          <Fragment key={i}>{renderInline(t.tokens)}</Fragment>
        );
      }
      case "image":
        // Only reachable inside links and headings; paragraphs split images out.
        return decodeEntities((token as Tokens.Image).text);
      case "br":
        return "\n";
      case "checkbox":
        return (token as Tokens.Checkbox).checked ? "☑ " : "☐ ";
      case "html": {
        const raw = (token as Tokens.HTML).raw;
        return /^<br\s*\/?>$/i.test(raw.trim()) ? "\n" : raw;
      }
      default: {
        const t = token as Tokens.Generic;
        return t.tokens?.length ? <Fragment key={i}>{renderInline(t.tokens)}</Fragment> : t.raw;
      }
    }
  });
}

function Paragraph({ tokens }: { tokens: Token[] }) {
  return (
    <View style={styles.paragraphWrap}>
      {splitInlineImages(tokens).map((segment, i) =>
        segment.kind === "image" ? (
          <MarkdownImage key={i} token={segment.token} />
        ) : (
          <Text key={i} style={styles.paragraph} selectable>
            {renderInline(segment.tokens)}
          </Text>
        ),
      )}
    </View>
  );
}

function MarkdownImage({ token }: { token: Tokens.Image }) {
  const src = imageTarget(token.href);
  if (!src) {
    return <Text style={styles.muted}>{`[${decodeEntities(token.text) || "image"}]`}</Text>;
  }
  return <InlineImage src={src} />;
}

function CodeBlock({ text }: { text: string }) {
  return (
    <ScrollView horizontal style={styles.codeBlock} nestedScrollEnabled>
      <Mono style={styles.codeText} selectable>
        {text}
      </Mono>
    </ScrollView>
  );
}

function List({ list }: { list: Tokens.List }) {
  const { theme } = useUnistyles();
  const start = list.start === "" ? 1 : list.start;
  return (
    <View style={styles.list}>
      {list.items.map((item, i) => {
        const [first, ...rest] = item.tokens;
        const checkbox = first?.type === "checkbox" ? (first as Tokens.Checkbox) : null;
        return (
          <View key={i} style={styles.item}>
            {checkbox ? (
              <Ionicons
                name={checkbox.checked ? "checkbox" : "square-outline"}
                size={17}
                color={checkbox.checked ? theme.colors.foreground : theme.colors.mutedForeground}
                style={styles.checkbox}
              />
            ) : (
              <Text style={styles.marker}>{list.ordered ? `${start + i}.` : "•"}</Text>
            )}
            <View style={styles.itemBody}>
              <Blocks tokens={checkbox ? rest : item.tokens} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Table({ table }: { table: Tokens.Table }) {
  const rows = [table.header, ...table.rows];
  return (
    <ScrollView horizontal style={styles.table} nestedScrollEnabled>
      <View>
        {rows.map((cells, r) => (
          <View key={r} style={styles.tableRow}>
            {cells.map((cell, c) => (
              <View key={c} style={[styles.cell, r === 0 && styles.cellHead]}>
                <Text
                  style={[
                    styles.cellText,
                    r === 0 && styles.strong,
                    { textAlign: cell.align ?? "left" },
                  ]}
                  selectable
                >
                  {renderInline(cell.tokens)}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Block({ token }: { token: Token }) {
  switch (token.type) {
    case "heading": {
      const t = token as Tokens.Heading;
      const level = [styles.h1, styles.h2, styles.h3, styles.h4, styles.h5, styles.h6];
      return (
        <Text
          style={[styles.heading, level[Math.min(Math.max(t.depth, 1), 6) - 1]]}
          accessibilityRole="header"
          selectable
        >
          {renderInline(t.tokens)}
        </Text>
      );
    }
    case "paragraph":
    case "text": {
      const t = token as Tokens.Paragraph | Tokens.Text;
      return <Paragraph tokens={t.tokens ?? [token]} />;
    }
    case "list":
      return <List list={token as Tokens.List} />;
    case "blockquote":
      return (
        <View style={styles.quote}>
          <Blocks tokens={(token as Tokens.Blockquote).tokens} />
        </View>
      );
    case "code":
      return <CodeBlock text={(token as Tokens.Code).text} />;
    case "hr":
      return <View style={styles.hr} />;
    case "table":
      return <Table table={token as Tokens.Table} />;
    case "html":
      return (
        <Mono style={styles.muted} selectable>
          {(token as Tokens.HTML).raw.trim()}
        </Mono>
      );
    case "space":
    case "def":
    case "checkbox":
      return null;
    default:
      return <Text style={styles.paragraph}>{token.raw}</Text>;
  }
}

function Blocks({ tokens }: { tokens: Token[] }) {
  return (
    <View style={styles.blocks}>
      {tokens.map((token, i) => (
        <Block key={i} token={token} />
      ))}
    </View>
  );
}

/** Markdown as inline blocks, for hosting inside another scroller (chat rows). */
export function MarkdownBody({ source }: { source: string }) {
  const tokens = useMemo(() => lexer(source), [source]);
  return <Blocks tokens={tokens} />;
}

export function MarkdownView({ source }: { source: string }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <MarkdownBody source={source} />
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  blocks: { gap: theme.spacing.md },
  paragraphWrap: { gap: theme.spacing.sm },
  paragraph: { fontSize: theme.fontSize.base, lineHeight: 23 },
  heading: { fontFamily: theme.fonts.bold, marginTop: theme.spacing.sm },
  h1: { fontSize: theme.fontSize.title - 4, fontFamily: theme.fonts.heavy, lineHeight: 32 },
  h2: { fontSize: theme.fontSize.xl, fontFamily: theme.fonts.heavy, lineHeight: 28 },
  h3: { fontSize: theme.fontSize.lg, lineHeight: 24 },
  h4: { fontSize: theme.fontSize.md, lineHeight: 22 },
  h5: { fontSize: theme.fontSize.base, lineHeight: 22 },
  h6: { fontSize: theme.fontSize.base, lineHeight: 22, color: theme.colors.mutedForeground },
  strong: { fontFamily: theme.fonts.bold },
  em: { fontStyle: "italic" },
  del: { textDecorationLine: "line-through", color: theme.colors.mutedForeground },
  codespan: {
    fontSize: theme.fontSize.sm,
    backgroundColor: theme.colors.muted,
  },
  link: { color: theme.colors.started, textDecorationLine: "underline" },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  list: { gap: theme.spacing.xs },
  item: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm },
  marker: {
    minWidth: 22,
    textAlign: "right",
    fontSize: theme.fontSize.base,
    lineHeight: 23,
    color: theme.colors.mutedForeground,
  },
  checkbox: { minWidth: 22, marginTop: 3, textAlign: "right" },
  itemBody: { flex: 1 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.hairline,
    paddingLeft: theme.spacing.md,
  },
  codeBlock: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  codeText: { fontSize: theme.fontSize.sm, lineHeight: 19 },
  hr: { height: 1, backgroundColor: theme.colors.hairline, marginVertical: theme.spacing.sm },
  table: {
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
  },
  tableRow: { flexDirection: "row" },
  cell: {
    width: 140,
    padding: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
  },
  cellHead: { backgroundColor: theme.colors.muted },
  cellText: { fontSize: theme.fontSize.sm, lineHeight: 19 },
}));
