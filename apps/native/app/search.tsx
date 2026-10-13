import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { IssueRow } from "@/components/issue-row";
import { EmptyState, ErrorNote, Input, Loading } from "@/components/ui";
import { api } from "@/lib/api";

/** Title search across every workspace the user belongs to (/api/me/issues). */
export default function Search() {
  const [text, setText] = useState("");
  const query = useDeferredValue(text.trim());

  const results = useQuery({
    queryKey: ["my-issues", "search", query],
    queryFn: () => api.myIssues({ search: query, limit: 50 }),
    enabled: query.length >= 2,
  });

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <View style={styles.header}>
        <Input
          value={text}
          onChangeText={setText}
          placeholder="Search issue titles"
          autoFocus
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <ErrorNote error={results.error} />
      </View>
      <FlatList
        data={query.length >= 2 ? (results.data?.results ?? []) : []}
        keyExtractor={(issue) => issue.id}
        renderItem={({ item }) => <IssueRow issue={item} showProject />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.length < 2 ? (
            <EmptyState
              icon="search"
              title="Search all workspaces"
              body="Type at least two letters."
            />
          ) : results.isPending ? (
            <Loading />
          ) : (
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
  separator: { height: 1, backgroundColor: theme.colors.hairline, marginLeft: 44 },
}));
