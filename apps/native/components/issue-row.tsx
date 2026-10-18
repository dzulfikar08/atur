import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Avatar, Mono, PriorityIcon, ProductChip, StateIcon, Text } from "@/components/ui";
import type { Issue } from "@/lib/api";
import { displayName, dueLabel, timeAgo } from "@/lib/format";
import { splitProduct } from "@/lib/product";

/**
 * One issue in a list: state glyph, key, product chip, due date, then the
 * title and state · project · updated with priority and assignees. Tapping
 * opens the detail screen.
 */
export function IssueRow({
  issue,
  slug,
  identifier,
  showProject,
}: {
  issue: Issue;
  /** Workspace slug; falls back to the row's own workspace_slug (me/issues). */
  slug?: string;
  identifier?: string | null;
  showProject?: boolean;
}) {
  const { theme } = useUnistyles();
  const ws = slug ?? issue.workspace_slug;
  const key = `${identifier ?? issue.project_identifier ?? "#"}-${issue.sequence_id}`;
  const { product, title } = splitProduct(issue.name);
  const closed = issue.state?.group === "completed" || issue.state?.group === "cancelled";
  const due = closed ? null : dueLabel(issue.target_date, new Date());
  const meta = [
    issue.state?.name,
    showProject ? issue.project_name : null,
    timeAgo(issue.updated_at),
  ]
    .filter(Boolean)
    .join(" · ");
  const assignees = issue.assignees ?? [];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${key} ${issue.name}`}
      disabled={!ws}
      onPress={() =>
        router.push({
          pathname: "/issue/[slug]/[projectId]/[issueId]",
          params: { slug: ws!, projectId: issue.project_id, issueId: issue.id },
        })
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.glyph}>
        <StateIcon state={issue.state} />
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Mono>{key}</Mono>
          {product ? <ProductChip product={product} /> : null}
          <View style={styles.spacer} />
          {due ? (
            <Text
              style={[
                styles.due,
                due.late && { color: theme.colors.urgent, fontFamily: theme.fonts.bold },
              ]}
            >
              {due.text}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.title, closed && styles.closed]} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          <PriorityIcon priority={issue.priority} size={14} />
          {assignees.slice(0, 2).map((a) => (
            <Avatar key={a.id} name={displayName(a)} uri={a.avatar} size={20} />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  pressed: { backgroundColor: theme.colors.surfaceHover },
  glyph: { paddingTop: 1 },
  body: { flex: 1, gap: 3 },
  topRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, minHeight: 20 },
  spacer: { flex: 1 },
  due: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  title: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.medium, lineHeight: 21 },
  closed: { color: theme.colors.mutedForeground },
  metaRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: 2 },
  meta: { flex: 1, fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
}));
