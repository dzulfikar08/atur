import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  Button,
  EmptyState,
  ErrorNote,
  ListGroup,
  PageHeader,
  Screen,
  Text,
} from "@/components/ui";
import { RowListSkeleton } from "@/components/skeletons";
import { api, type Notification } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export default function Inbox() {
  const { theme } = useUnistyles();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const list = useQuery({ queryKey: ["notifications", "list"], queryFn: api.notifications });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const markRead = useMutation({ mutationFn: api.markNotificationRead, onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: api.markAllNotificationsRead, onSuccess: invalidate });

  const items = list.data?.results.filter((n) => !n.archived_at) ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  const slugById = Object.fromEntries((me.data?.workspaces ?? []).map((w) => [w.id, w.slug]));

  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    const slug = slugById[n.workspace_id];
    // entity_name is the entity kind ("issue"); entity_identifier its id.
    if (slug && n.project_id && n.entity_name === "issue" && n.entity_identifier) {
      router.push({
        pathname: "/issue/[slug]/[projectId]/[issueId]",
        params: { slug, projectId: n.project_id, issueId: n.entity_identifier },
      });
    }
  };

  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <PageHeader
        title="Inbox"
        caption={unread ? `${unread} unread` : "All caught up"}
        right={
          unread ? (
            <Button
              variant="secondary"
              label="Mark all read"
              loading={markAll.isPending}
              onPress={() => markAll.mutate()}
            />
          ) : undefined
        }
      />
      <ErrorNote error={list.error ?? markAll.error} />
      {list.isPending ? (
        <RowListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="No notifications"
          body="Assignments, mentions, and comments on issues you follow show up here."
        />
      ) : (
        <ListGroup>
          {items.map((n) => (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              onPress={() => open(n)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View
                style={[styles.dot, !n.read_at && { backgroundColor: theme.colors.unstarted }]}
              />
              <View style={styles.body}>
                <Text style={[styles.title, n.read_at ? styles.read : null]} numberOfLines={2}>
                  {n.title ?? "Notification"}
                </Text>
                {n.message ? (
                  <Text style={styles.message} numberOfLines={2}>
                    {n.message}
                  </Text>
                ) : null}
                <Text style={styles.time}>{timeAgo(n.created_at)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
            </Pressable>
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  pressed: { backgroundColor: theme.colors.muted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold },
  read: { fontFamily: theme.fonts.regular, color: theme.colors.mutedForeground },
  message: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, lineHeight: 19 },
  time: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
}));
