import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { openPaneScreen } from "@/components/pane-actions";
import {
  Button,
  Chip,
  ErrorNote,
  Input,
  ListGroup,
  ListRow,
  SectionTitle,
  Sheet,
  Text,
} from "@/components/ui";
import { api, type CreatedPaneWorkspace, type PaneListItem } from "@/lib/api";
import { customPath, newestPane, newWorkspaceTargets, workspaceKey } from "@/lib/pane-workspaces";

type Stage = "closed" | "menu" | "workspace";

const CUSTOM = "\0custom";

/**
 * The Panes tab's "+" sheet. With a workspace selected it offers a new pane in
 * it (splits that workspace's most recent pane); "New workspace" opens a repo
 * folder, picked from the caller's bound repos or typed. Without a selection
 * the sheet opens straight on the workspace form.
 */
export function usePaneCreate({
  panes,
  selected,
  selectedLabel,
  onWorkspaceCreated,
}: {
  panes: readonly PaneListItem[];
  /** Key of the workspace the list is filtered to, null for All. */
  selected: string | null;
  selectedLabel: string | null;
  /** Receives the new workspace's key so the list can switch to it. */
  onWorkspaceCreated: (key: string) => void;
}): { open: () => void; sheet: ReactNode } {
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>("closed");
  const newest = selected ? newestPane(panes, selected) : null;

  const splitNew = useMutation({
    mutationFn: (pane: PaneListItem) => api.splitPane(pane.pane_id, "right"),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["panes"] });
      setStage("closed");
      openPaneScreen(created.pane_id);
    },
  });

  const sheet = (
    <Sheet
      visible={stage !== "closed"}
      tall={stage === "workspace"}
      title={stage === "workspace" ? "New workspace" : "New"}
      onClose={() => setStage("closed")}
      headerRight={
        stage === "workspace" && newest ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setStage("menu")}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
        ) : null
      }
    >
      {stage === "menu" ? (
        <View>
          {newest ? (
            <ListRow
              icon="add-circle-outline"
              title={`New pane in ${selectedLabel ?? "this workspace"}`}
              subtitle="Splits its most recent pane to the right"
              onPress={() => splitNew.mutate(newest)}
            />
          ) : null}
          <ListRow
            icon="folder-open-outline"
            title="New workspace"
            subtitle="Open a repo folder as its own workspace"
            onPress={() => setStage("workspace")}
          />
          <ErrorNote error={splitNew.error} />
        </View>
      ) : null}
      {stage === "workspace" ? (
        <WorkspaceForm
          onCreated={(created) => {
            setStage("closed");
            onWorkspaceCreated(workspaceKey(created.workspace.machine?.id, created.workspace.id));
            openPaneScreen(created.pane.pane_id);
          }}
        />
      ) : null}
    </Sheet>
  );

  return {
    open: () => {
      splitNew.reset();
      setStage(newest ? "menu" : "workspace");
    },
    sheet,
  };
}

function WorkspaceForm({ onCreated }: { onCreated: (created: CreatedPaneWorkspace) => void }) {
  const { theme } = useUnistyles();
  const qc = useQueryClient();
  const targetsQuery = useQuery({ queryKey: ["pane-targets"], queryFn: api.paneTargets });
  const targets = useMemo(
    () => (targetsQuery.data ? newWorkspaceTargets(targetsQuery.data) : []),
    [targetsQuery.data],
  );

  // `undefined` = the first target; null is the dev box, a string a machine id.
  const [targetId, setTargetId] = useState<string | null | undefined>(undefined);
  const target =
    (targetId === undefined ? undefined : targets.find((t) => t.machineId === targetId)) ??
    targets[0];
  const [pick, setPick] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const [name, setName] = useState("");

  // A pick that belongs to another target no longer applies; with no pick the first folder wins.
  const picked =
    pick !== null && pick !== CUSTOM && target?.paths.some((p) => p.path === pick) ? pick : null;
  const useCustom = pick === CUSTOM || (picked === null && (target?.paths.length ?? 0) === 0);
  const selectedPath = useCustom ? null : (picked ?? target?.paths[0]?.path ?? null);
  const cwd = useCustom ? customPath(customText) : selectedPath;

  const create = useMutation({
    mutationFn: () =>
      api.createPaneWorkspace({
        cwd: cwd ?? "",
        label: name.trim() || undefined,
        machine_id: target?.machineId ?? undefined,
      }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["panes"] });
      void qc.invalidateQueries({ queryKey: ["pane-targets"] });
      onCreated(created);
    },
  });

  if (targetsQuery.isPending) return <ActivityIndicator color={theme.colors.mutedForeground} />;
  if (targetsQuery.isError) return <ErrorNote error={targetsQuery.error} />;
  if (!target) {
    return (
      <Text style={styles.hint}>
        No place to open a workspace yet. Bind a repo folder to one of your Atur workspaces, or
        connect a machine.
      </Text>
    );
  }

  const check = <Ionicons name="checkmark" size={18} color={theme.colors.foreground} />;
  return (
    <View style={styles.form}>
      {targets.length > 1 ? (
        <View style={styles.group}>
          <SectionTitle title="Where" />
          <View style={styles.wrap}>
            {targets.map((t) => (
              <Chip
                key={t.machineId ?? "dev"}
                label={t.name}
                selected={t.machineId === target.machineId}
                onPress={() => {
                  setTargetId(t.machineId);
                  setPick(null);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.group}>
        <SectionTitle title="Folder" />
        <ListGroup>
          {target.paths.map((p) => (
            <ListRow
              key={p.path}
              icon="folder-outline"
              title={p.label}
              subtitle={p.path}
              right={selectedPath === p.path ? check : undefined}
              onPress={() => setPick(p.path)}
            />
          ))}
          <ListRow
            icon="create-outline"
            title="Custom path"
            right={useCustom ? check : undefined}
            onPress={() => setPick(CUSTOM)}
          />
        </ListGroup>
        {useCustom ? (
          <Input
            placeholder="/home/you/project"
            value={customText}
            onChangeText={setCustomText}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Folder path"
          />
        ) : null}
      </View>

      <Input
        label="Name (optional)"
        placeholder="Defaults to the folder name"
        value={name}
        onChangeText={setName}
        maxLength={64}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ErrorNote error={create.error} />
      <Button
        label="Create workspace"
        loading={create.isPending}
        disabled={!cwd}
        onPress={() => create.mutate()}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  group: { gap: theme.spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  back: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.medium },
}));
