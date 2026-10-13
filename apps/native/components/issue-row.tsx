import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Avatar, Mono, PriorityIcon, StateIcon, Text } from "@/components/ui";
import type { Issue } from "@/lib/api";
import { displayName, timeAgo } from "@/lib/format";

/**
 * One issue in a list: state glyph, key, title, then project · updated and
 * priority/assignees. Tapping opens the detail screen.
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
  const ws = slug ?? issue.workspace_slug;
  const key = `${identifier ?? issue.project_identifier ?? "#"}-${issue.sequence_id}`;
  const meta = [showProject ? issue.project_name : null, timeAgo(issue.updated_at)]
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
        <StateIcon group={issue.state?.group} color={issue.state?.color} />
      </View>
      <View style={styles.body}>
        <Mono>{key}</Mono>
        <Text style={styles.title} numberOfLines={2}>
          {issue.name}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {issue.state?.name ? `${issue.state.name} · ${meta}` : meta}
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
  pressed: { backgroundColor: theme.colors.muted },
  glyph: { paddingTop: 18 },
  body: { flex: 1, gap: 3 },
  title: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.medium, lineHeight: 21 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: 2 },
  meta: { flex: 1, fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
}));
