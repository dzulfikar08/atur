import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  Chip,
  EmptyState,
  ErrorNote,
  ListGroup,
  ListRow,
  Loading,
  PageHeader,
  Screen,
  Text,
} from "@/components/ui";
import { api } from "@/lib/api";

export default function Projects() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const [picked, setPicked] = useState<string | null>(null);

  const workspaces = me.data?.workspaces ?? [];
  const slug = picked ?? workspaces[0]?.slug ?? null;
  const visible = (projects.data ?? []).filter((p) => p.workspace_slug === slug);

  return (
    <Screen
      refreshing={projects.isRefetching}
      onRefresh={() => {
        void me.refetch();
        void projects.refetch();
      }}
    >
      <PageHeader title="Projects" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipStrip}
      >
        {workspaces.map((w) => (
          <Chip
            key={w.id}
            label={w.name}
            selected={w.slug === slug}
            onPress={() => setPicked(w.slug)}
          />
        ))}
      </ScrollView>
      <ErrorNote error={projects.error} />

      {projects.isPending || me.isPending ? (
        <Loading />
      ) : visible.length === 0 ? (
        <EmptyState icon="folder-open-outline" title="No projects in this workspace" />
      ) : (
        <ListGroup>
          {visible.map((p) => (
            <ListRow
              key={p.id}
              left={
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {p.emoji || (p.identifier ?? p.name).slice(0, 3)}
                  </Text>
                </View>
              }
              title={p.name}
              subtitle={p.is_pipeline ? "Pipeline" : (p.identifier ?? undefined)}
              chevron
              onPress={() =>
                router.push({
                  pathname: "/project/[slug]/[projectId]",
                  params: { slug: p.workspace_slug, projectId: p.id },
                })
              }
            />
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  chipStrip: { marginHorizontal: -theme.spacing.lg, flexGrow: 0 },
  chips: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  badge: {
    minWidth: 38,
    height: 30,
    paddingHorizontal: 6,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontFamily: theme.fonts.mono },
}));
