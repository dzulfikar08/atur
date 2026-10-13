import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { IssueRow } from "@/components/issue-row";
import {
  EmptyState,
  ErrorNote,
  Fab,
  IconButton,
  ListGroup,
  ListRow,
  Loading,
  PageHeader,
  PriorityIcon,
  Screen,
  SectionTitle,
  Text,
} from "@/components/ui";
import { api, type Issue } from "@/lib/api";
import { displayName } from "@/lib/format";
import { ALL, useCurrentWorkspace } from "@/lib/workspace";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function IssueSection({
  title,
  issues,
  total,
  empty,
}: {
  title: string;
  issues: Issue[] | undefined;
  total: number | undefined;
  empty: string;
}) {
  return (
    <>
      <SectionTitle
        title={title}
        right={total ? <Text style={styles.count}>{total}</Text> : undefined}
      />
      {issues === undefined ? (
        <Loading />
      ) : issues.length === 0 ? (
        <Text style={styles.emptyLine}>{empty}</Text>
      ) : (
        <ListGroup>
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} showProject />
          ))}
        </ListGroup>
      )}
    </>
  );
}

export default function Home() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { slug, workspace } = useCurrentWorkspace();
  // /api/me/issues filters by workspace id; undefined = all workspaces.
  const workspaceId = workspace?.id;
  const decisions = useQuery({ queryKey: ["decisions"], queryFn: api.decisions });
  const needsYou = useQuery({
    queryKey: ["my-issues", "needs_you", workspaceId],
    queryFn: () => api.myIssues({ state_key: "needs_you", workspace: workspaceId, limit: 20 }),
  });
  const inProgress = useQuery({
    queryKey: ["my-issues", "in_progress", workspaceId],
    queryFn: () => api.myIssues({ state_key: "in_progress", workspace: workspaceId, limit: 20 }),
  });
  const waiting = (decisions.data ?? []).filter((d) => slug === ALL || d.workspace_slug === slug);

  const refreshing = decisions.isRefetching || needsYou.isRefetching || inProgress.isRefetching;
  const refresh = () => {
    void me.refetch();
    void decisions.refetch();
    void needsYou.refetch();
    void inProgress.refetch();
  };

  const noWorkspaces = me.data && me.data.workspaces.length === 0;

  return (
    <View style={styles.flex}>
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {noWorkspaces ? null : <WorkspaceSwitcher />}
        <PageHeader
          title={greeting()}
          caption={me.data ? displayName(me.data) : undefined}
          right={
            <IconButton
              icon="search"
              label="Search issues"
              onPress={() => router.push("/search")}
            />
          }
        />
        <ErrorNote error={me.error ?? needsYou.error} />

        {noWorkspaces ? (
          <EmptyState
            icon="briefcase-outline"
            title="No workspaces yet"
            body="Create a workspace on app.diatur.com, then pull to refresh."
          />
        ) : (
          <>
            {waiting.length > 0 ? (
              <>
                <SectionTitle
                  title="Decisions waiting"
                  right={<Text style={styles.count}>{waiting.length}</Text>}
                />
                <ListGroup>
                  {waiting.slice(0, 5).map((d) => (
                    <ListRow
                      key={d.id}
                      left={<PriorityIcon priority={d.priority} />}
                      title={d.name}
                      subtitle={`${d.project_identifier}-${d.sequence_id} · ${d.project_name}`}
                      chevron
                      onPress={() =>
                        router.push({
                          pathname: "/issue/[slug]/[projectId]/[issueId]",
                          params: {
                            slug: d.workspace_slug,
                            projectId: d.project_id,
                            issueId: d.id,
                          },
                        })
                      }
                    />
                  ))}
                </ListGroup>
              </>
            ) : null}

            <IssueSection
              title="Needs you"
              issues={needsYou.data?.results}
              total={needsYou.data?.total}
              empty="Nothing is waiting on you."
            />
            <IssueSection
              title="In progress"
              issues={inProgress.data?.results}
              total={inProgress.data?.total}
              empty="Nothing in progress."
            />
          </>
        )}
      </Screen>
      {noWorkspaces ? null : (
        <Fab icon="add" label="New issue" onPress={() => router.push("/new-issue")} />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  count: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    color: theme.colors.mutedForeground,
  },
  emptyLine: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    paddingVertical: theme.spacing.sm,
  },
}));
