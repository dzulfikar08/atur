import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, SectionList, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { DateSheet } from "@/components/date-sheet";
import { IssueRow } from "@/components/issue-row";
import { IssueListSkeleton } from "@/components/skeletons";
import {
  Button,
  Chip,
  EmptyState,
  ErrorNote,
  IconButton,
  Input,
  PriorityIcon,
  Sheet,
  StateIcon,
  Text,
} from "@/components/ui";
import { api, type Issue, type Priority } from "@/lib/api";
import { usePersistedQuery } from "@/lib/issue-filters";
import {
  DEFAULT_QUERY,
  DUE_FILTERS,
  DUE_FILTER_LABEL,
  GROUP_BYS,
  GROUP_BY_LABEL,
  MY_ISSUES_QUERY,
  PRESET_VIEWS,
  PRIORITY_VALUES,
  PROJECT_QUERY,
  SORT_FIELDS,
  SORT_FIELD_LABEL,
  STATE_KEYS,
  STATE_KEY_LABEL,
  activeFilterCount,
  applyIssueQuery,
  deriveFilterOptions,
  groupIssues,
  normalizeIssueQuery,
  sameQuery,
  sortStates,
  type IssueGroup,
  type QueryState,
} from "@/lib/issue-query";
import { formatDay } from "@/lib/format";
import { stateColor } from "@/theme";
import { ALL, useCurrentWorkspace } from "@/lib/workspace";

export type IssueListScope =
  | { kind: "project"; slug: string; projectId: string }
  | { kind: "mine" };

type DateField = "target_from" | "target_to" | "start_from" | "start_to";

const DATE_ROWS: { field: DateField; label: string }[] = [
  { field: "target_from", label: "Target from" },
  { field: "target_to", label: "Target to" },
  { field: "start_from", label: "Start from" },
  { field: "start_to", label: "Start to" },
];

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

const priorityLabel = (p: string) =>
  p === "none" ? "No priority" : p[0].toUpperCase() + p.slice(1);

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

interface Section {
  key: string;
  group: IssueGroup<Issue>;
  data: Issue[];
}

/**
 * The web's filterable list on a phone: project issues (or My Issues across
 * workspaces) with multi-value filters, sort, grouping and saved views, all
 * evaluated client-side by the shared IssueQuery so a view saved on the web
 * filters identically here. The query is remembered per project on the device.
 */
export function IssueList({ scope }: { scope: IssueListScope }) {
  const { theme } = useUnistyles();
  const qc = useQueryClient();
  const isProject = scope.kind === "project";
  const slug = isProject ? scope.slug : undefined;
  const projectId = isProject ? scope.projectId : undefined;
  const { slug: workspaceSlug } = useCurrentWorkspace();

  const defaults = isProject ? PROJECT_QUERY : MY_ISSUES_QUERY;
  const scopeKey = isProject ? `p.${projectId}` : `me.${workspaceSlug}`;
  const { query, ready, setQuery, replaceQuery, reset } = usePersistedQuery(scopeKey, defaults);

  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const project = projects.data?.find((p) => p.id === projectId);

  const issuesQuery = useQuery({
    queryKey: isProject
      ? ["project-issues", slug, projectId]
      : ["my-issues", workspaceSlug === ALL ? ALL : workspaceSlug],
    queryFn: () =>
      isProject
        ? api.projectIssues(slug!, projectId!)
        : api.allMyIssues(workspaceSlug === ALL ? undefined : workspaceSlug),
  });
  const states = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.states(slug!, projectId!),
    enabled: isProject,
  });
  const modules = useQuery({
    queryKey: ["modules", slug, projectId],
    queryFn: () => api.modules(slug!, projectId!),
    enabled: isProject,
  });
  const savedViews = useQuery({
    queryKey: ["views", slug, projectId],
    queryFn: () => api.views(slug!, projectId!),
    enabled: isProject,
  });

  const [sheet, setSheet] = useState<"filters" | "save" | null>(null);
  const [dateField, setDateField] = useState<DateField | null>(null);
  const [viewName, setViewName] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const issues = issuesQuery.data;
  // Project lists know the workflow; cross-project lists derive it from the rows.
  const queryStates = useMemo<QueryState[]>(() => {
    if (isProject) return sortStates(states.data ?? []);
    const map = new Map<string, QueryState>();
    for (const i of issues ?? []) if (i.state) map.set(i.state.id, { ...i.state, sequence: 0 });
    return sortStates([...map.values()]);
  }, [isProject, states.data, issues]);

  const deferredQ = useDeferredValue(query.q);
  const effective = useMemo(() => ({ ...query, q: deferredQ }), [query, deferredQ]);
  const meId = me.data?.id ?? null;

  const filtered = useMemo(
    () => applyIssueQuery(issues ?? [], effective, meId, { states: queryStates }),
    [issues, effective, meId, queryStates],
  );
  const sections = useMemo<Section[]>(
    () =>
      groupIssues(filtered, effective.group, {
        states: queryStates,
        me: meId,
        modules: modules.data,
      }).map((group) => ({
        key: group.key,
        group,
        data: collapsed[`${effective.group}:${group.key}`] ? [] : group.issues,
      })),
    [filtered, effective.group, queryStates, meId, modules.data, collapsed],
  );
  const options = useMemo(
    () => deriveFilterOptions(issues ?? [], queryStates),
    [issues, queryStates],
  );

  const filterCount = activeFilterCount(query, defaults);
  const dirty = !sameQuery({ ...query, q: "" }, defaults);

  const presets = [
    { id: "all", name: isProject ? "All" : "My open work", query: defaults },
    ...PRESET_VIEWS.map((p) => ({ ...p, query: { ...p.query, view: defaults.view } })),
  ];
  const saved = (savedViews.data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    query: normalizeIssueQuery(v.query, DEFAULT_QUERY),
  }));

  const saveView = useMutation({
    mutationFn: () =>
      api.saveView(slug!, projectId!, viewName.trim(), { ...query, q: "", view: "list" }),
    onSuccess: () => {
      setSheet(null);
      setViewName("");
      void qc.invalidateQueries({ queryKey: ["views", slug, projectId] });
    },
  });
  const deleteView = useMutation({
    mutationFn: (id: string) => api.deleteView(slug!, projectId!, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["views", slug, projectId] }),
  });

  const confirmDelete = (id: string, name: string) =>
    Alert.alert(`Delete “${name}”?`, "This view is removed from the web too.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteView.mutate(id) },
    ]);

  const loading = !ready || issuesQuery.isPending || (isProject && states.isPending);
  const refreshing = issuesQuery.isRefetching;

  const header = (
    <View style={styles.header}>
      <View style={styles.searchRow}>
        <View style={styles.flex}>
          <Input
            value={query.q}
            onChangeText={(q) => setQuery({ q })}
            placeholder="Filter issues"
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <IconButton
          icon="options-outline"
          label="Filters, sort and grouping"
          badge={filterCount || undefined}
          onPress={() => setSheet("filters")}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipStrip}
        keyboardShouldPersistTaps="handled"
      >
        {presets.map((p) => (
          <Chip
            key={p.id}
            label={p.name}
            selected={sameQuery({ ...query, q: "" }, p.query)}
            onPress={() => replaceQuery(p.query)}
          />
        ))}
        {saved.map((v) => (
          <Chip
            key={v.id}
            label={v.name}
            selected={sameQuery({ ...query, q: "" }, { ...v.query, view: defaults.view })}
            onPress={() => replaceQuery({ ...v.query, view: defaults.view })}
            onLongPress={() => confirmDelete(v.id, v.name)}
          />
        ))}
        {isProject && dirty ? <Chip label="+ Save view" onPress={() => setSheet("save")} /> : null}
      </ScrollView>

      <Text style={styles.count}>
        {loading
          ? "Loading…"
          : `${filtered.length} ${filtered.length === 1 ? "issue" : "issues"}${
              query.group === "none" ? "" : ` · by ${GROUP_BY_LABEL[query.group].toLowerCase()}`
            }`}
      </Text>
      <ErrorNote error={issuesQuery.error} />
    </View>
  );

  return (
    <>
      <SectionList<Issue, Section>
        sections={loading ? [] : sections}
        keyExtractor={(issue) => issue.id}
        renderItem={({ item }) => (
          <IssueRow
            issue={item}
            slug={slug}
            identifier={project?.identifier}
            showProject={!isProject}
          />
        )}
        renderSectionHeader={({ section }) => {
          const { group } = section;
          if (group.kind === "none") return null;
          const isCollapsed = collapsed[`${effective.group}:${group.key}`];
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !isCollapsed }}
              onPress={() =>
                setCollapsed((c) => ({ ...c, [`${effective.group}:${group.key}`]: !isCollapsed }))
              }
              style={styles.groupHeader}
            >
              <Ionicons
                name={isCollapsed ? "chevron-forward" : "chevron-down"}
                size={14}
                color={theme.colors.mutedForeground}
              />
              {group.kind === "state" ? <StateIcon state={group.state} size={15} /> : null}
              {group.kind === "priority" ? (
                <PriorityIcon priority={(group.priority ?? "none") as Priority} size={14} />
              ) : null}
              <Text style={styles.groupLabel} numberOfLines={1}>
                {group.label}
              </Text>
              <Text style={styles.groupCount}>{group.issues.length}</Text>
            </Pressable>
          );
        }}
        stickySectionHeadersEnabled
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void issuesQuery.refetch();
              if (isProject) void savedViews.refetch();
            }}
            tintColor={theme.colors.mutedForeground}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <IssueListSkeleton />
          ) : (
            <EmptyState
              icon="checkmark-done-outline"
              title={filterCount || dirty ? "No matching issues" : "No issues yet"}
              body={
                filterCount || dirty
                  ? "Loosen a filter or pick another view."
                  : isProject
                    ? "Tap + to create the first one."
                    : "Nothing is assigned to you."
              }
              action={dirty ? { label: "Reset filters", onPress: reset } : undefined}
            />
          )
        }
        ListFooterComponent={<View style={styles.footer} />}
        style={styles.list}
      />

      <Sheet
        visible={sheet === "filters"}
        title="Filters"
        tall
        done
        onClose={() => setSheet(null)}
        headerRight={
          dirty ? (
            <Pressable
              accessibilityRole="button"
              onPress={reset}
              hitSlop={8}
              style={styles.resetLink}
            >
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
          ) : undefined
        }
      >
        <View style={styles.sheetBody}>
          <FilterSection title="State">
            {STATE_KEYS.map((key) => (
              <Chip
                key={key}
                label={`${STATE_KEY_LABEL[key]}${options.counts.state[key] ? ` ${options.counts.state[key]}` : ""}`}
                dot={stateColor(theme.colors, { key })}
                selected={query.state.includes(key)}
                onPress={() => setQuery({ state: toggle(query.state, key) })}
              />
            ))}
            <Chip
              label="Show done"
              selected={query.done === "show"}
              onPress={() => setQuery({ done: query.done === "show" ? "hide" : "show" })}
            />
          </FilterSection>

          <FilterSection title="Priority">
            {PRIORITY_VALUES.map((p) => (
              <Chip
                key={p}
                label={`${priorityLabel(p)}${options.counts.priority[p] ? ` ${options.counts.priority[p]}` : ""}`}
                selected={query.priority.includes(p)}
                onPress={() => setQuery({ priority: toggle(query.priority, p) })}
              />
            ))}
          </FilterSection>

          <FilterSection title="Assignee">
            <Chip
              label="Me"
              selected={query.assignee.includes("me")}
              onPress={() => setQuery({ assignee: toggle(query.assignee, "me") })}
            />
            <Chip
              label="Unassigned"
              selected={query.assignee.includes("none")}
              onPress={() => setQuery({ assignee: toggle(query.assignee, "none") })}
            />
            {options.assignees
              .filter((a) => a.id !== meId)
              .map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  selected={query.assignee.includes(a.id)}
                  onPress={() => setQuery({ assignee: toggle(query.assignee, a.id) })}
                />
              ))}
          </FilterSection>

          {options.labels.length > 0 ? (
            <FilterSection title="Label">
              {options.labels.map((l) => (
                <Chip
                  key={l.id}
                  label={l.name}
                  dot={l.color || theme.colors.backlog}
                  selected={query.label.includes(l.id)}
                  onPress={() => setQuery({ label: toggle(query.label, l.id) })}
                />
              ))}
            </FilterSection>
          ) : null}

          {options.products.length > 0 ? (
            <FilterSection title="Product">
              {options.products.map((p) => (
                <Chip
                  key={p}
                  label={`${p} ${options.counts.product[p] ?? ""}`.trim()}
                  selected={query.product.includes(p)}
                  onPress={() => setQuery({ product: toggle(query.product, p) })}
                />
              ))}
            </FilterSection>
          ) : null}

          {isProject && (modules.data?.length ?? 0) > 0 ? (
            <FilterSection title="Module">
              {modules.data!.map((m) => (
                <Chip
                  key={m.id}
                  label={m.name}
                  selected={query.module.includes(m.id)}
                  onPress={() => setQuery({ module: toggle(query.module, m.id) })}
                />
              ))}
            </FilterSection>
          ) : null}

          <FilterSection title="Due">
            {DUE_FILTERS.map((d) => (
              <Chip
                key={d}
                label={DUE_FILTER_LABEL[d]}
                selected={query.due === d}
                onPress={() => setQuery({ due: d })}
              />
            ))}
            <Chip
              label="Decisions only"
              selected={query.decision}
              onPress={() => setQuery({ decision: !query.decision })}
            />
          </FilterSection>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Date range</Text>
            <View style={styles.dateGrid}>
              {DATE_ROWS.map(({ field, label }) => (
                <Pressable
                  key={field}
                  accessibilityRole="button"
                  onPress={() => setDateField(field)}
                  style={({ pressed }) => [styles.dateCell, pressed && styles.pressed]}
                >
                  <Text style={styles.dateLabel}>{label}</Text>
                  <Text style={styles.dateValue}>
                    {query[field] ? formatDay(query[field]) : "Any"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <FilterSection title="Sort by">
            {SORT_FIELDS.map((f) => (
              <Chip
                key={f}
                label={SORT_FIELD_LABEL[f]}
                selected={query.sort.field === f}
                onPress={() => setQuery({ sort: { ...query.sort, field: f } })}
              />
            ))}
          </FilterSection>
          <FilterSection title="Order">
            <Chip
              label="Descending"
              selected={query.sort.dir === "desc"}
              onPress={() => setQuery({ sort: { ...query.sort, dir: "desc" } })}
            />
            <Chip
              label="Ascending"
              selected={query.sort.dir === "asc"}
              onPress={() => setQuery({ sort: { ...query.sort, dir: "asc" } })}
            />
          </FilterSection>

          <FilterSection title="Group by">
            {GROUP_BYS.filter((g) => g !== "module" || isProject).map((g) => (
              <Chip
                key={g}
                label={GROUP_BY_LABEL[g]}
                selected={query.group === g}
                onPress={() => setQuery({ group: g })}
              />
            ))}
          </FilterSection>
        </View>

        <DateSheet
          visible={dateField !== null}
          title={DATE_ROWS.find((r) => r.field === dateField)?.label ?? "Date"}
          value={dateField ? query[dateField] : null}
          clearLabel="Any"
          onPick={(value) => dateField && setQuery({ [dateField]: value ?? "" })}
          onClose={() => setDateField(null)}
        />
      </Sheet>

      <Sheet visible={sheet === "save"} title="Save view" onClose={() => setSheet(null)}>
        <View style={styles.saveBody}>
          <Input
            value={viewName}
            onChangeText={setViewName}
            placeholder="View name"
            autoFocus
            maxLength={80}
          />
          <Text style={styles.saveHint}>
            Saves the current filters, sort and grouping. It also appears on the web.
          </Text>
          <ErrorNote error={saveView.error} />
          <Button
            label="Save view"
            loading={saveView.isPending}
            disabled={!viewName.trim()}
            onPress={() => saveView.mutate()}
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  list: { flex: 1 },
  header: { gap: theme.spacing.md, padding: theme.spacing.lg, paddingTop: theme.spacing.sm },
  searchRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  chipStrip: { marginHorizontal: -theme.spacing.lg, flexGrow: 0 },
  chips: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  count: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  separator: { height: 1, backgroundColor: theme.colors.hairline, marginLeft: 44 },
  footer: { height: 96 },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceCard,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.hairline,
  },
  groupLabel: { flexShrink: 1, fontSize: theme.fontSize.sm, fontFamily: theme.fonts.bold },
  groupCount: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  sheetBody: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  section: { gap: theme.spacing.sm },
  sectionLabel: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: theme.colors.mutedForeground,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  dateGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  dateCell: {
    width: "48.5%",
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    gap: 2,
  },
  dateLabel: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  dateValue: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.medium },
  pressed: { opacity: 0.6 },
  resetLink: { marginLeft: "auto", marginRight: theme.spacing.lg },
  resetText: { fontSize: theme.fontSize.base, color: theme.colors.destructive },
  saveBody: { padding: theme.spacing.md, gap: theme.spacing.md },
  saveHint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
}));
