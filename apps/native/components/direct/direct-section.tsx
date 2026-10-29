import "@/unistyles";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ListGroup, Mono, SectionTitle, Text } from "@/components/ui";
import {
  DIRECT_ATTENTION_LABEL,
  directAttention,
  directSessionDetail,
  directSessionTitle,
  openableSessions,
} from "@/lib/direct/session-meta";
import { useDirect } from "@/lib/direct/use-direct";
import type { DirectSession } from "@/modules/atur-direct/src/types";

function SessionRow({ session }: { session: DirectSession }) {
  const { theme } = useUnistyles();
  const attention = directAttention(session);
  const status = attention === "shell" ? null : DIRECT_ATTENTION_LABEL[attention];
  const dot = {
    "needs-you": theme.colors.urgent,
    working: theme.colors.started,
    idle: theme.colors.cancelled,
    shell: theme.colors.cancelled,
  }[attention];
  const detail = directSessionDetail(session);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open session ${session.id}, ${directSessionTitle(session)}${status ? `, ${status}` : ""}`}
      onPress={() =>
        router.push({ pathname: "/direct-pane/[sessionId]", params: { sessionId: session.id } })
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {directSessionTitle(session)}
        </Text>
        {detail ? <Mono numberOfLines={1}>{detail}</Mono> : null}
      </View>
      {status ? (
        <Text style={[styles.status, attention !== "idle" && { color: dot }]}>{status}</Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The Panes tab's Direct section: terminals on the paired computer, listed by the computer
 * itself, shown while connected. Each opens `/direct-pane/<id>`, a route that needs no account.
 */
export function DirectSessionsSection() {
  const direct = useDirect();
  if (direct.state !== "connected") return null;
  const sessions = openableSessions(direct.sessions);

  return (
    <>
      <SectionTitle title={direct.serverName ? `Direct · ${direct.serverName}` : "Direct"} />
      {sessions.length === 0 ? (
        <Text style={styles.empty}>No terminals open on this computer.</Text>
      ) : (
        <ListGroup>
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ListGroup>
      )}
    </>
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
  pressed: { backgroundColor: theme.colors.surfaceHover },
  dot: { width: 10, height: 10, borderRadius: 5 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold },
  status: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.mono,
    color: theme.colors.mutedForeground,
  },
  empty: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
}));
