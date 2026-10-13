import "@/unistyles";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useDeferredValue, useState } from "react";
import { FlatList, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { IssueRow } from "@/components/issue-row";
import { Chip, EmptyState, ErrorNote, Fab, Input, Loading } from "@/components/ui";
import { api } from "@/lib/api";

const PAGE = 50;

export default function ProjectIssues() {
  const { theme } = useUnistyles();
  const { slug, projectId } = useLocalSearchParams<{ slug: string; projectId: string }>();
  const [stateId, setStateId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const project = projects.data?.find((p) => p.id === projectId);
  const states = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.states(slug, projectId),
  });

  const issues = useInfiniteQuery({
    queryKey: ["project-issues", slug, projectId, stateId, query],
    queryFn: ({ pageParam }) =>
      api.projectIssues(slug, projectId, {
        state: stateId,
        search: query,
        offset: pageParam,
        limit: PAGE,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
  const rows = issues.data?.pages.flatMap((p) => p.results) ?? [];
  const sortedStates = [...(states.data ?? [])].sort((a, b) => a.sequence - b.sequence);

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen options={{ title: project?.name ?? "Issues" }} />
      <FlatList
        data={rows}
        keyExtractor={(issue) => issue.id}
        renderItem={({ item }) => (
          <IssueRow issue={item} slug={slug} identifier={project?.identifier} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onEndReached={() => {
          if (issues.hasNextPage && !issues.isFetchingNextPage) void issues.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={issues.isRefetching && !issues.isFetchingNextPage}
            onRefresh={() => void issues.refetch()}
            tintColor={theme.colors.mutedForeground}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder="Filter issues"
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              style={styles.chipStrip}
              keyboardShouldPersistTaps="handled"
            >
              <Chip label="All" selected={!stateId} onPress={() => setStateId(undefined)} />
              {sortedStates.map((s) => (
                <Chip
                  key={s.id}
                  label={s.name}
                  dot={s.color ?? theme.colors[s.group]}
                  selected={stateId === s.id}
                  onPress={() => setStateId(stateId === s.id ? undefined : s.id)}
                />
              ))}
            </ScrollView>
            <ErrorNote error={issues.error} />
          </View>
        }
        ListEmptyComponent={
          issues.isPending ? (
            <Loading />
          ) : (
            <EmptyState
              icon="checkmark-done-outline"
              title={query || stateId ? "No matching issues" : "No issues yet"}
              body={query || stateId ? "Try another filter." : "Tap + to create the first one."}
            />
          )
        }
        ListFooterComponent={
          issues.isFetchingNextPage ? <Loading /> : <View style={styles.footer} />
        }
        style={styles.list}
      />
      <Fab
        icon="add"
        label="New issue"
        onPress={() => router.push({ pathname: "/new-issue", params: { slug, projectId } })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  list: { flex: 1 },
  header: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingTop: theme.spacing.sm },
  chipStrip: { marginHorizontal: -theme.spacing.lg, flexGrow: 0 },
  chips: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  separator: { height: 1, backgroundColor: theme.colors.hairline, marginLeft: 44 },
  footer: { height: 96 },
}));
