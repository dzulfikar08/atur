import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AttachmentList } from "@/components/attachment/attachment-list";
import { DateSheet } from "@/components/date-sheet";
import { MicButton } from "@/components/mic-button";
import { RichText } from "@/components/rich-text";
import { IssueDetailSkeleton } from "@/components/skeletons";
import {
  Avatar,
  Button,
  ErrorNote,
  IconButton,
  Input,
  Mono,
  OptionSheet,
  PRIORITIES,
  PriorityIcon,
  ProductChip,
  SectionTitle,
  StateBadge,
  StateIcon,
  Text,
} from "@/components/ui";
import {
  api,
  type IssueActivity,
  type IssueDetail as IssueDetailData,
  type IssuePatch,
  type Priority,
} from "@/lib/api";
import { SERVER_URL } from "@/lib/config";
import {
  displayName,
  dueLabel,
  formatDay,
  formatDuration,
  htmlToBlocks,
  textToHtml,
  timeAgo,
} from "@/lib/format";
import { compareStates } from "@/lib/issue-query";
import { splitProduct } from "@/lib/product";
import { priorityColor } from "@/theme";

type SheetKind =
  | "state"
  | "priority"
  | "assignees"
  | "labels"
  | "estimate"
  | "modules"
  | "start"
  | "target"
  | null;
type Tab = "comments" | "activity" | "subissues" | "relations";

const ESTIMATES = [0, 1, 2, 3, 5, 8, 13, 21];

const FIELD_LABELS: Record<string, string> = {
  state: "State",
  priority: "Priority",
  name: "Title",
  description_html: "Description",
  start_date: "Start date",
  target_date: "Target date",
  estimate_points: "Estimate",
  is_decision: "Decision flag",
};

const RELATION_LABELS: Record<string, string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  relates_to: "Related to",
  duplicates: "Duplicates",
};

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

function activityText(a: IssueActivity): string {
  const who = a.actor_name || a.actor_email?.split("@")[0] || "Someone";
  if (a.verb !== "updated" || !a.field) return `${who} ${a.verb ?? "changed"} this issue`;
  const label = FIELD_LABELS[a.field] ?? a.field.replace(/_/g, " ");
  if (a.field === "description_html") return `${who} edited the description`;
  const fmt = (v: string | null) =>
    v === null ? "none" : a.field?.endsWith("_date") ? formatDay(v) : v;
  return `${who} changed ${label}${a.old_value || a.new_value ? ` from ${fmt(a.old_value)} to ${fmt(a.new_value)}` : ""}`;
}

function PropTile({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={label}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.tileValue, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    </View>
  );
}

export default function IssueDetail() {
  const { theme } = useUnistyles();
  const qc = useQueryClient();
  const { slug, projectId, issueId } = useLocalSearchParams<{
    slug: string;
    projectId: string;
    issueId: string;
  }>();
  const issueKey = ["issue", slug, projectId, issueId];

  // One request: the issue plus comments, activity, relations, sub-issues,
  // followers and modules (?include=). Everything below hangs off it.
  const issue = useQuery({
    queryKey: issueKey,
    queryFn: () => api.issue(slug, projectId, issueId),
  });
  const loaded = !!issue.data;
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  // Picker options start loading as soon as the issue renders, in parallel.
  const states = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.states(slug, projectId),
    enabled: loaded,
    staleTime: 5 * 60_000,
  });
  const labels = useQuery({
    queryKey: ["labels", slug, projectId],
    queryFn: () => api.labels(slug, projectId),
    enabled: loaded,
    staleTime: 5 * 60_000,
  });
  const members = useQuery({
    queryKey: ["members", slug],
    queryFn: () => api.members(slug),
    enabled: loaded,
    staleTime: 5 * 60_000,
  });
  const modules = useQuery({
    queryKey: ["modules", slug, projectId],
    queryFn: () => api.modules(slug, projectId),
    enabled: loaded,
    staleTime: 5 * 60_000,
  });

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [tab, setTab] = useState<Tab>("comments");

  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: ["project-issues"] });
    void qc.invalidateQueries({ queryKey: ["my-issues"] });
    void qc.invalidateQueries({ queryKey: ["today"] });
    void qc.invalidateQueries({ queryKey: ["decisions"] });
  };

  // Optimistic: the rail changes on tap, rolls back if the server refuses.
  const update = useMutation({
    mutationFn: (patch: IssuePatch) => api.updateIssue(slug, projectId, issueId, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: issueKey });
      const previous = qc.getQueryData<IssueDetailData>(issueKey);
      qc.setQueryData<IssueDetailData>(issueKey, (old) => {
        if (!old) return old;
        const next: IssueDetailData = { ...old };
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.priority !== undefined) next.priority = patch.priority;
        if (patch.start_date !== undefined) next.start_date = patch.start_date;
        if (patch.target_date !== undefined) next.target_date = patch.target_date;
        if (patch.estimate_points !== undefined) next.estimate_points = patch.estimate_points;
        if (patch.state_id !== undefined) {
          const s = states.data?.find((x) => x.id === patch.state_id);
          if (s) {
            next.state_id = s.id;
            next.state = { id: s.id, name: s.name, color: s.color, group: s.group, key: s.key };
          }
        }
        if (patch.assignee_ids) {
          next.assignees = patch.assignee_ids.flatMap(
            (id) => members.data?.find((m) => m.member_id === id)?.member ?? [],
          );
        }
        if (patch.label_ids) {
          next.labels = patch.label_ids.flatMap(
            (id) => labels.data?.find((l) => l.id === id) ?? [],
          );
        }
        return next;
      });
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(issueKey, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: issueKey });
      refreshLists();
    },
  });

  const moduleToggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      on
        ? api.addIssueModule(slug, projectId, issueId, id)
        : api.removeIssueModule(slug, projectId, issueId, id),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: issueKey });
      const previous = qc.getQueryData<IssueDetailData>(issueKey);
      qc.setQueryData<IssueDetailData>(issueKey, (old) => {
        if (!old?.included) return old;
        const current = old.included.modules.results;
        const results = on
          ? [...current, ...(modules.data?.filter((m) => m.id === id) ?? [])]
          : current.filter((m) => m.id !== id);
        return { ...old, included: { ...old.included, modules: { results } } };
      });
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(issueKey, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: issueKey });
      void qc.invalidateQueries({ queryKey: ["project-issues"] });
    },
  });

  const follow = useMutation({
    mutationFn: (on: boolean) =>
      on ? api.followIssue(slug, projectId, issueId) : api.unfollowIssue(slug, projectId, issueId),
    onMutate: async (on) => {
      await qc.cancelQueries({ queryKey: issueKey });
      const previous = qc.getQueryData<IssueDetailData>(issueKey);
      qc.setQueryData<IssueDetailData>(issueKey, (old) => {
        if (!old?.included || !me.data) return old;
        const others = old.included.subscribers.results.filter(
          (s) => s.subscriber_id !== me.data!.id,
        );
        const results = on
          ? [...others, { id: "pending", subscriber_id: me.data.id, user: null }]
          : others;
        return { ...old, included: { ...old.included, subscribers: { results } } };
      });
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(issueKey, ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: issueKey }),
  });

  const addComment = useMutation({
    mutationFn: () => api.addComment(slug, projectId, issueId, textToHtml(comment)),
    onSuccess: () => {
      setComment("");
      void qc.invalidateQueries({ queryKey: issueKey });
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
          <IssueDetailSkeleton />
        )}
      </SafeAreaView>
    );
  }

  const included = data.included;
  const key = `${data.project_detail.identifier}-${data.sequence_id}`;
  const { product, title } = splitProduct(data.name);
  const assigneeIds = (data.assignees ?? []).map((a) => a.id);
  const labelIds = (data.labels ?? []).map((l) => l.id);
  const moduleIds = (included?.modules.results ?? []).map((m) => m.id);
  const hasDescription = htmlToBlocks(data.description_html).length > 0;
  const comments = included?.comments.results ?? [];
  const thread = [...comments].reverse();
  const activities = [...(included?.activities.results ?? [])].reverse();
  const subIssues = included?.sub_issues.results ?? [];
  const relations = included?.relations.results ?? [];
  const refs = new Map((included?.related_issues ?? []).map((r) => [r.id, r]));
  const parent = data.parent_id ? refs.get(data.parent_id) : undefined;
  const following =
    !!me.data && !!included?.subscribers.results.some((s) => s.subscriber_id === me.data!.id);
  const due = dueLabel(data.target_date, new Date());
  const closed = data.state?.group === "completed" || data.state?.group === "cancelled";
  const webUrl = `${SERVER_URL}/${slug}/projects/${projectId}/issues/${data.sequence_id}`;
  const open = (sheetKind: SheetKind) => () => setSheet(sheetKind);
  const myId = me.data?.id;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "comments", label: "Comments", count: comments.length },
    { id: "activity", label: "Activity", count: activities.length },
    ...(subIssues.length
      ? [{ id: "subissues" as const, label: "Sub-issues", count: subIssues.length }]
      : []),
    ...(relations.length
      ? [{ id: "relations" as const, label: "Relations", count: relations.length }]
      : []),
  ];

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
          <View style={styles.keyRow}>
            <Mono>{`${key} · ${data.project_detail.name}`}</Mono>
            {product ? <ProductChip product={product} /> : null}
          </View>
          {parent ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/issue/[slug]/[projectId]/[issueId]",
                  params: { slug, projectId, issueId: data.parent_id! },
                })
              }
              style={({ pressed }) => [styles.parent, pressed && styles.pressed]}
            >
              <Ionicons name="return-down-forward" size={14} color={theme.colors.mutedForeground} />
              <Text style={styles.parentText} numberOfLines={1}>
                {`Sub-issue of ${data.project_detail.identifier}-${parent.sequence_id} · ${parent.name}`}
              </Text>
            </Pressable>
          ) : null}
          {editingTitle === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Edit title"
              onPress={() => setEditingTitle(data.name)}
            >
              <Text style={styles.title}>{title}</Text>
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
          <ErrorNote error={update.error ?? moduleToggle.error ?? follow.error} />

          <View style={styles.rail}>
            <View style={styles.grid}>
              <PropTile label="State" onPress={open("state")}>
                <StateBadge state={data.state} name={data.state?.name} />
              </PropTile>
              <PropTile label="Priority" onPress={open("priority")}>
                <PriorityIcon priority={data.priority} size={16} />
                <Text
                  style={[styles.tileText, { color: priorityColor(theme.colors, data.priority) }]}
                >
                  {PRIORITIES.find((p) => p.value === (data.priority ?? "none"))?.label}
                </Text>
              </PropTile>
              <PropTile label="Assignee" onPress={open("assignees")}>
                {data.assignees?.length ? (
                  <>
                    {data.assignees.slice(0, 3).map((a) => (
                      <Avatar key={a.id} name={displayName(a)} uri={a.avatar} size={20} />
                    ))}
                    <Text style={styles.tileText} numberOfLines={1}>
                      {data.assignees.map((a) => displayName(a)).join(", ")}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.tilePlaceholder}>Unassigned</Text>
                )}
              </PropTile>
              <PropTile label="Estimate" onPress={open("estimate")}>
                <Text
                  style={data.estimate_points != null ? styles.tileText : styles.tilePlaceholder}
                >
                  {data.estimate_points != null ? `${data.estimate_points} pts` : "No estimate"}
                </Text>
              </PropTile>
              <PropTile label="Start date" onPress={open("start")}>
                <Ionicons name="calendar-outline" size={14} color={theme.colors.mutedForeground} />
                <Text style={data.start_date ? styles.tileText : styles.tilePlaceholder}>
                  {data.start_date ? formatDay(data.start_date) : "Set date"}
                </Text>
              </PropTile>
              <PropTile label="Target date" onPress={open("target")}>
                <Ionicons
                  name="calendar-outline"
                  size={14}
                  color={due?.late && !closed ? theme.colors.urgent : theme.colors.mutedForeground}
                />
                <Text
                  style={[
                    data.target_date ? styles.tileText : styles.tilePlaceholder,
                    due?.late && !closed && { color: theme.colors.urgent },
                  ]}
                >
                  {data.target_date
                    ? `${formatDay(data.target_date)}${due && !closed ? ` · ${due.text}` : ""}`
                    : "Set date"}
                </Text>
              </PropTile>
              <PropTile label="Labels" onPress={open("labels")}>
                {data.labels?.length ? (
                  <Text style={styles.tileText} numberOfLines={1}>
                    {data.labels.map((l) => l.name).join(", ")}
                  </Text>
                ) : (
                  <Text style={styles.tilePlaceholder}>No labels</Text>
                )}
              </PropTile>
              <PropTile label="Modules" onPress={open("modules")}>
                {included?.modules.results.length ? (
                  <Text style={styles.tileText} numberOfLines={1}>
                    {included.modules.results.map((m) => m.name).join(", ")}
                  </Text>
                ) : (
                  <Text style={styles.tilePlaceholder}>No modules</Text>
                )}
              </PropTile>
              <PropTile label="Follow" onPress={() => follow.mutate(!following)}>
                <Ionicons
                  name={following ? "notifications" : "notifications-outline"}
                  size={15}
                  color={following ? theme.colors.foreground : theme.colors.mutedForeground}
                />
                <Text style={following ? styles.tileText : styles.tilePlaceholder}>
                  {following ? "Following" : "Follow"}
                  {included && included.subscribers.results.length > 0
                    ? `  ${included.subscribers.results.length}`
                    : ""}
                </Text>
              </PropTile>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>{`Created ${formatDay(data.created_at)}`}</Text>
              <Text style={styles.meta}>{`Updated ${timeAgo(data.updated_at)}`}</Text>
              {included && included.counts.time_seconds > 0 ? (
                <Text
                  style={styles.meta}
                >{`${formatDuration(included.counts.time_seconds)} logged`}</Text>
              ) : null}
            </View>
          </View>

          <SectionTitle title="Description" />
          {hasDescription ? (
            <RichText html={data.description_html} style={styles.description} />
          ) : (
            <Text style={styles.muted}>No description.</Text>
          )}

          {included && included.counts.attachments > 0 ? (
            <AttachmentList
              slug={slug}
              projectId={projectId}
              issueId={issueId}
              count={included.counts.attachments}
            />
          ) : null}

          <View style={styles.tabs} accessibilityRole="tablist">
            {tabs.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.id }}
                onPress={() => setTab(t.id)}
                style={[styles.tab, tab === t.id && styles.tabActive]}
              >
                <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>
                  {t.count ? `${t.label} ${t.count}` : t.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === "comments" ? (
            <>
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
              {thread.length === 0 ? <Text style={styles.muted}>No comments yet.</Text> : null}
            </>
          ) : null}

          {tab === "activity" ? (
            <>
              {activities.map((a) => (
                <View key={a.id} style={styles.activity}>
                  <View style={styles.activityDot} />
                  <Text style={styles.activityText}>{activityText(a)}</Text>
                  <Text style={styles.meta}>{timeAgo(a.created_at)}</Text>
                </View>
              ))}
              {activities.length === 0 ? <Text style={styles.muted}>No activity yet.</Text> : null}
            </>
          ) : null}

          {tab === "subissues"
            ? subIssues.map((s) => (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: "/issue/[slug]/[projectId]/[issueId]",
                      params: { slug, projectId: s.project_id, issueId: s.id },
                    })
                  }
                  style={({ pressed }) => [styles.related, pressed && styles.pressed]}
                >
                  <StateIcon state={s.state} />
                  <Mono>{`${data.project_detail.identifier}-${s.sequence_id}`}</Mono>
                  <Text style={styles.relatedName} numberOfLines={1}>
                    {s.name}
                  </Text>
                </Pressable>
              ))
            : null}

          {tab === "relations"
            ? relations.map((r) => {
                const ref = refs.get(r.related_issue_id);
                return (
                  <View key={r.id} style={styles.related}>
                    <Text style={styles.relationType}>
                      {RELATION_LABELS[r.relation_type] ?? r.relation_type}
                    </Text>
                    <Mono>{ref ? `#${ref.sequence_id}` : ""}</Mono>
                    <Text style={styles.relatedName} numberOfLines={1}>
                      {ref?.name ?? "Issue"}
                    </Text>
                  </View>
                );
              })
            : null}
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
          <MicButton value={comment} onChangeText={setComment} />
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
        options={[...(states.data ?? [])].sort(compareStates).map((s) => ({
          key: s.id,
          label: s.name,
          selected: s.id === data.state_id,
          left: <StateIcon state={s} />,
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
        onSelect={(value) => update.mutate({ priority: value as Priority })}
      />
      <OptionSheet
        visible={sheet === "assignees"}
        title="Assignees"
        multi
        onClose={() => setSheet(null)}
        options={[...(members.data ?? [])]
          .filter((m) => m.member)
          // "Assign to me" first, like the web's quick action.
          .sort((a, b) => Number(b.member_id === myId) - Number(a.member_id === myId))
          .map((m) => ({
            key: m.member_id,
            label: m.member_id === myId ? `${displayName(m.member!)} (me)` : displayName(m.member!),
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
      <OptionSheet
        visible={sheet === "estimate"}
        title="Estimate (points)"
        onClose={() => setSheet(null)}
        options={[
          { key: "none", label: "No estimate", selected: data.estimate_points == null },
          ...ESTIMATES.map((p) => ({
            key: String(p),
            label: `${p} pts`,
            selected: data.estimate_points === p,
          })),
        ]}
        onSelect={(v) => update.mutate({ estimate_points: v === "none" ? null : Number(v) })}
      />
      <OptionSheet
        visible={sheet === "modules"}
        title="Modules"
        multi
        onClose={() => setSheet(null)}
        options={(modules.data ?? []).map((m) => ({
          key: m.id,
          label: m.name,
          selected: moduleIds.includes(m.id),
        }))}
        onSelect={(id) => moduleToggle.mutate({ id, on: !moduleIds.includes(id) })}
      />
      <DateSheet
        visible={sheet === "start"}
        title="Start date"
        value={data.start_date}
        onPick={(value) => update.mutate({ start_date: value })}
        onClose={() => setSheet(null)}
      />
      <DateSheet
        visible={sheet === "target"}
        title="Target date"
        value={data.target_date}
        onPick={(value) => update.mutate({ target_date: value })}
        onClose={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  pad: { padding: theme.spacing.lg },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  keyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, flexWrap: "wrap" },
  parent: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs },
  parentText: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  title: {
    fontSize: theme.fontSize.xl,
    fontFamily: theme.fonts.heavy,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  titleEdit: { gap: theme.spacing.sm },
  titleActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing.sm },
  rail: {
    backgroundColor: theme.colors.surfaceCard,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing.md,
    rowGap: theme.spacing.md,
  },
  tile: { width: "47.5%", gap: 4 },
  tileLabel: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.mono,
    color: theme.colors.mutedForeground,
  },
  tileValue: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surfaceElevated,
  },
  tileText: { flexShrink: 1, fontSize: theme.fontSize.sm, fontFamily: theme.fonts.medium },
  tilePlaceholder: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  metaRow: { flexDirection: "row", flexWrap: "wrap", columnGap: theme.spacing.lg, rowGap: 2 },
  meta: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  description: { fontSize: theme.fontSize.base, lineHeight: 23 },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  tabs: {
    flexDirection: "row",
    padding: 3,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.muted,
    marginTop: theme.spacing.sm,
  },
  tab: {
    flex: 1,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.sm + 2,
  },
  tabActive: { backgroundColor: theme.colors.card },
  tabText: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.medium,
    color: theme.colors.mutedForeground,
  },
  tabTextActive: { color: theme.colors.foreground, fontFamily: theme.fonts.bold },
  comment: { flexDirection: "row", gap: theme.spacing.md, paddingVertical: theme.spacing.xs },
  commentMeta: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  commentAuthor: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.bold,
    color: theme.colors.foreground,
  },
  commentBody: { fontSize: theme.fontSize.base, lineHeight: 22, marginTop: 2 },
  activity: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.hairline },
  activityText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  related: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.hairline,
  },
  relatedName: { flex: 1, fontSize: theme.fontSize.base, fontFamily: theme.fonts.medium },
  relationType: { fontSize: theme.fontSize.xs, fontFamily: theme.fonts.bold, minWidth: 74 },
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
