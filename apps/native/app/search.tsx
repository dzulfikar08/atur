import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { IssueRow } from "@/components/issue-row";
import { IssueListSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorNote, Input, ListGroup, ListRow, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { ALL, useCurrentWorkspace } from "@/lib/workspace";

/**
 * Issue search, the same call as the web Cmd+K palette: GET /api/me/issues?q=
 * sorted by recent activity, scoped to the current workspace (or all of them),
 * debounced 180 ms, two characters minimum. Matching projects are listed first,
 * as the palette's "Go to project".
 */
export default function Search() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const { slug, workspace } = useCurrentWorkspace();

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 180);
    return () => clearTimeout(t);
  }, [text]);

  const active = query.length >= 2;
  const results = useQuery({
    queryKey: ["issue-search", slug, query],
    queryFn: () => api.searchIssues(query, slug === ALL ? undefined : slug),
    enabled: active,
    staleTime: 15_000,
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const matchingProjects = active
    ? (projects.data ?? [])
        .filter(
          (p) =>
            (slug === ALL || p.workspace_slug === slug) &&
            p.name.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 4)
    : [];

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <View style={styles.header}>
        <Input
          value={text}
          onChangeText={setText}
          placeholder="Search issues and projects"
          autoFocus
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <ErrorNote error={results.error} />
      </View>
      <FlatList
        data={active ? (results.data ?? []) : []}
        keyExtractor={(issue) => issue.id}
        renderItem={({ item }) => <IssueRow issue={item} showProject />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          matchingProjects.length > 0 ? (
            <View style={styles.projects}>
              <SectionTitle title="Projects" />
              <ListGroup>
                {matchingProjects.map((p) => (
                  <ListRow
                    key={p.id}
                    icon="folder-open-outline"
                    title={p.name}
                    subtitle={slug === ALL ? p.workspace_name : undefined}
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
              {(results.data?.length ?? 0) > 0 ? <SectionTitle title="Issues" /> : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          !active ? (
            <EmptyState
              icon="search"
              title={workspace ? `Search ${workspace.name}` : "Search all workspaces"}
              body="Type at least two letters."
            />
          ) : results.isPending ? (
            <IssueListSkeleton rows={5} />
          ) : matchingProjects.length > 0 ? null : (
            <EmptyState icon="file-tray-outline" title={`No issues match “${query}”`} />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  header: { padding: theme.spacing.lg, paddingTop: theme.spacing.sm, gap: theme.spacing.sm },
  projects: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  separator: { height: 1, backgroundColor: theme.colors.hairline, marginLeft: 44 },
}));
