import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ListGroup, ListRow, SectionTitle, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { ATTENTION_LABEL, paneAttention, paneTitle, unseenAttentionPanes } from "@/lib/pane-meta";
import { usePaneSeen } from "@/lib/pane-seen";

const MAX_ROWS = 3;

/**
 * Agent panes that finished or need the user and haven't been opened since.
 * Renders nothing otherwise, and nothing on error (the Panes tab owns that UI).
 */
export function AgentsSection() {
  const { theme } = useUnistyles();
  const seen = usePaneSeen();
  const panes = useQuery({ queryKey: ["panes"], queryFn: api.panes });
  const waiting = panes.data ? unseenAttentionPanes(panes.data, seen) : [];
  if (waiting.length === 0) return null;

  return (
    <>
      <SectionTitle title="Agents" right={<Text style={styles.count}>{waiting.length}</Text>} />
      <ListGroup>
        {waiting.slice(0, MAX_ROWS).map((pane) => {
          const needsYou = paneAttention(pane) === "needs-you";
          const color = needsYou ? theme.colors.urgent : theme.colors.completed;
          const label = ATTENTION_LABEL[needsYou ? "needs-you" : "done"];
          const title = paneTitle(pane);
          return (
            <ListRow
              key={pane.pane_id}
              left={<View style={[styles.dot, { backgroundColor: color }]} />}
              title={title}
              value={label}
              accessibilityLabel={`${label}: ${title}`}
              chevron
              onPress={() =>
                router.push({ pathname: "/pane/[paneId]", params: { paneId: pane.pane_id } })
              }
            />
          );
        })}
      </ListGroup>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  count: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    color: theme.colors.mutedForeground,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
}));
