import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { IssueList } from "@/components/issue-list";
import { Fab } from "@/components/ui";
import { api } from "@/lib/api";

export default function ProjectIssues() {
  const { slug, projectId } = useLocalSearchParams<{ slug: string; projectId: string }>();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const project = projects.data?.find((p) => p.id === projectId);

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen options={{ title: project?.name ?? "Issues" }} />
      <IssueList scope={{ kind: "project", slug, projectId }} />
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
}));
