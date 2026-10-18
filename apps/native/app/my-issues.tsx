import "@/unistyles";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { IssueList } from "@/components/issue-list";
import { Fab } from "@/components/ui";

/** Web "My Issues": assigned to me and not finished, across workspaces (or the current one). */
export default function MyIssues() {
  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <IssueList scope={{ kind: "mine" }} />
      <Fab icon="add" label="New issue" onPress={() => router.push("/new-issue")} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
}));
