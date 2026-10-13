import "@/unistyles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  Avatar,
  Button,
  ErrorNote,
  IconButton,
  Input,
  ListGroup,
  ListRow,
  Loading,
  Mono,
  OptionSheet,
  PRIORITIES,
  PriorityIcon,
  SectionTitle,
  StateIcon,
  Text,
} from "@/components/ui";
import { api, type Issue, type IssuePatch } from "@/lib/api";
import { SERVER_URL } from "@/lib/config";
import { RichText } from "@/components/rich-text";
import { displayName, htmlToBlocks, textToHtml, timeAgo } from "@/lib/format";

type SheetKind = "state" | "priority" | "assignees" | "labels" | null;

export default function IssueDetail() {
  const { theme } = useUnistyles();
  const qc = useQueryClient();
  const { slug, projectId, issueId } = useLocalSearchParams<{
    slug: string;
    projectId: string;
    issueId: string;
  }>();
  const issueKey = ["issue", slug, projectId, issueId];

  const issue = useQuery({
    queryKey: issueKey,
    queryFn: () => api.issue(slug, projectId, issueId),
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const states = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.states(slug, projectId),
  });
  const labels = useQuery({
    queryKey: ["labels", slug, projectId],
    queryFn: () => api.labels(slug, projectId),
  });
  const members = useQuery({ queryKey: ["members", slug], queryFn: () => api.members(slug) });
  const comments = useQuery({
    queryKey: ["comments", slug, projectId, issueId],
    queryFn: () => api.comments(slug, projectId, issueId),
  });

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const update = useMutation({
    mutationFn: (patch: IssuePatch) => api.updateIssue(slug, projectId, issueId, patch),
    onSuccess: (updated) => {
      qc.setQueryData<Issue>(issueKey, (prev) => ({ ...prev, ...updated }));
      void qc.invalidateQueries({ queryKey: issueKey });
      void qc.invalidateQueries({ queryKey: ["project-issues"] });
      void qc.invalidateQueries({ queryKey: ["my-issues"] });
      void qc.invalidateQueries({ queryKey: ["decisions"] });
    },
  });
  const addComment = useMutation({
    mutationFn: () => api.addComment(slug, projectId, issueId, textToHtml(comment)),
    onSuccess: () => {
      setComment("");
      void qc.invalidateQueries({ queryKey: ["comments", slug, projectId, issueId] });
    },
  });

  const data = issue.data;
  if (!data) {
    return (
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        {issue.error ? (
          <View style={styles.pad}>
            <ErrorNote error={issue.error} />
          </View>
        ) : (
          <Loading />
        )}
      </SafeAreaView>
    );
  }

  const project = projects.data?.find((p) => p.id === projectId);
  const key = `${project?.identifier ?? "#"}-${data.sequence_id}`;
  const assigneeIds = (data.assignees ?? []).map((a) => a.id);
  const labelIds = (data.labels ?? []).map((l) => l.id);
  const toggle = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  const hasDescription = htmlToBlocks(data.description_html).length > 0;
  const thread = [...(comments.data?.results ?? [])].reverse();
  const webUrl = `${SERVER_URL}/${slug}/projects/${projectId}/issues/${data.sequence_id}`;

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: key,
          headerRight: () => (
            <IconButton
              icon="open-outline"
              label="Open on the web"
              onPress={() => void WebBrowser.openBrowserAsync(webUrl)}
            />
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Mono>{`${key} · ${project?.name ?? ""}`}</Mono>
          {editingTitle === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Edit title"
              onPress={() => setEditingTitle(data.name)}
            >
              <Text style={styles.title}>{data.name}</Text>
            </Pressable>
          ) : (
            <View style={styles.titleEdit}>
              <Input value={editingTitle} onChangeText={setEditingTitle} multiline autoFocus />
              <View style={styles.titleActions}>
                <Button variant="ghost" label="Cancel" onPress={() => setEditingTitle(null)} />
                <Button
                  label="Save"
                  loading={update.isPending}
                  disabled={!editingTitle.trim()}
                  onPress={() =>
                    update.mutate(
                      { name: editingTitle.trim() },
                      { onSuccess: () => setEditingTitle(null) },
                    )
                  }
                />
              </View>
            </View>
          )}
          <ErrorNote error={update.error} />

          <ListGroup>
            <ListRow
              left={<StateIcon group={data.state?.group} color={data.state?.color} size={18} />}
              title={data.state?.name ?? "No state"}
              value="State"
              chevron
              onPress={() => setSheet("state")}
            />
            <ListRow
              left={<PriorityIcon priority={data.priority} size={18} />}
              title={
                PRIORITIES.find((p) => p.value === (data.priority ?? "none"))?.label ??
                "No priority"
              }
              value="Priority"
              chevron
              onPress={() => setSheet("priority")}
            />
            <ListRow
              icon="people-outline"
              title={
                data.assignees?.length
                  ? data.assignees.map((a) => displayName(a)).join(", ")
                  : "Unassigned"
              }
              value="Assignees"
              chevron
              onPress={() => setSheet("assignees")}
            />
            <ListRow
              icon="pricetags-outline"
              title={data.labels?.length ? data.labels.map((l) => l.name).join(", ") : "No labels"}
              value="Labels"
              chevron
              onPress={() => setSheet("labels")}
            />
            {data.target_date ? (
              <ListRow icon="calendar-outline" title={data.target_date.slice(0, 10)} value="Due" />
            ) : null}
          </ListGroup>

          <SectionTitle title="Description" />
          {hasDescription ? (
            <RichText html={data.description_html} style={styles.description} />
          ) : (
            <Text style={styles.muted}>No description.</Text>
          )}

          <SectionTitle
            title="Comments"
            right={
              comments.data?.total ? (
                <Text style={styles.muted}>{comments.data.total}</Text>
              ) : undefined
            }
          />
          <ErrorNote error={comments.error} />
          {thread.map((c) => {
            const author = c.actor_detail ? displayName(c.actor_detail) : "Someone";
            return (
              <View key={c.id} style={styles.comment}>
                <Avatar name={author} uri={c.actor_detail?.avatar} size={28} />
                <View style={styles.flex}>
                  <Text style={styles.commentMeta}>
                    <Text style={styles.commentAuthor}>{author}</Text>
                    {`  ${timeAgo(c.created_at)}`}
                  </Text>
                  <RichText
                    html={c.comment_html || c.comment_stripped}
                    style={styles.commentBody}
                  />
                </View>
              </View>
            );
          })}
          {comments.data && thread.length === 0 ? (
            <Text style={styles.muted}>No comments yet.</Text>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <View style={styles.flex}>
            <Input
              value={comment}
              onChangeText={setComment}
              placeholder="Add a comment…"
              multiline
              style={styles.composerInput}
            />
          </View>
          <IconButton
            icon={addComment.isPending ? "hourglass-outline" : "send"}
            label="Send comment"
            onPress={() => {
              if (comment.trim() && !addComment.isPending) addComment.mutate();
            }}
          />
        </View>
        {addComment.error ? (
          <View style={styles.pad}>
            <ErrorNote error={addComment.error} />
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <OptionSheet
        visible={sheet === "state"}
        title="State"
        onClose={() => setSheet(null)}
        options={[...(states.data ?? [])]
          .sort((a, b) => a.sequence - b.sequence)
          .map((s) => ({
            key: s.id,
            label: s.name,
            selected: s.id === data.state_id,
            left: <StateIcon group={s.group} color={s.color} />,
          }))}
        onSelect={(id) => update.mutate({ state_id: id })}
      />
      <OptionSheet
        visible={sheet === "priority"}
        title="Priority"
        onClose={() => setSheet(null)}
        options={PRIORITIES.map((p) => ({
          key: p.value,
          label: p.label,
          selected: (data.priority ?? "none") === p.value,
          left: <PriorityIcon priority={p.value} />,
        }))}
        onSelect={(value) => update.mutate({ priority: value as IssuePatch["priority"] })}
      />
      <OptionSheet
        visible={sheet === "assignees"}
        title="Assignees"
        multi
        onClose={() => setSheet(null)}
        options={(members.data ?? [])
          .filter((m) => m.member)
          .map((m) => ({
            key: m.member_id,
            label: displayName(m.member!),
            selected: assigneeIds.includes(m.member_id),
            left: <Avatar name={displayName(m.member!)} uri={m.member!.avatar} size={24} />,
          }))}
        onSelect={(id) => update.mutate({ assignee_ids: toggle(assigneeIds, id) })}
      />
      <OptionSheet
        visible={sheet === "labels"}
        title="Labels"
        multi
        onClose={() => setSheet(null)}
        options={(labels.data ?? []).map((l) => ({
          key: l.id,
          label: l.name,
          selected: labelIds.includes(l.id),
          left: (
            <View style={[styles.labelDot, { backgroundColor: l.color || theme.colors.backlog }]} />
          ),
        }))}
        onSelect={(id) => update.mutate({ label_ids: toggle(labelIds, id) })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  pad: { padding: theme.spacing.lg },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  title: {
    fontSize: theme.fontSize.xl,
    fontFamily: theme.fonts.heavy,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  titleEdit: { gap: theme.spacing.sm },
  titleActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing.sm },
  description: { fontSize: theme.fontSize.base, lineHeight: 23 },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  comment: { flexDirection: "row", gap: theme.spacing.md, paddingVertical: theme.spacing.xs },
  commentMeta: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  commentAuthor: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.bold,
    color: theme.colors.foreground,
  },
  commentBody: { fontSize: theme.fontSize.base, lineHeight: 22, marginTop: 2 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.background,
  },
  composerInput: { minHeight: 42, maxHeight: 120, paddingTop: 10 },
  labelDot: { width: 10, height: 10, borderRadius: 5 },
}));
