import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import {
  EmptyState,
  ErrorNote,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Text,
} from "@/components/ui";
import { RowListSkeleton } from "@/components/skeletons";
import { api } from "@/lib/api";
import { ALL, useCurrentWorkspace } from "@/lib/workspace";

export default function Projects() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const { slug } = useCurrentWorkspace();
  const visible = (projects.data ?? []).filter((p) => slug === ALL || p.workspace_slug === slug);

  return (
    <Screen
      refreshing={projects.isRefetching}
      onRefresh={() => {
        void me.refetch();
        void projects.refetch();
      }}
    >
      <WorkspaceSwitcher />
      <PageHeader title="Projects" />
      <ListGroup>
        <ListRow
          icon="person-outline"
          title="My issues"
          subtitle="Assigned to me, across projects"
          chevron
          onPress={() => router.push("/my-issues")}
        />
      </ListGroup>
      <ErrorNote error={projects.error} />

      {projects.isPending || me.isPending ? (
        <RowListSkeleton />
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
              subtitle={[
                p.is_pipeline ? "Pipeline" : p.identifier,
                slug === ALL ? p.workspace_name : null,
              ]
                .filter(Boolean)
                .join(" · ")}
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
