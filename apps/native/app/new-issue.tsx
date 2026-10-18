import "@/unistyles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { MicButton } from "@/components/mic-button";
import {
  Button,
  ErrorNote,
  Input,
  ListGroup,
  ListRow,
  OptionSheet,
  PRIORITIES,
  PriorityIcon,
  StateIcon,
} from "@/components/ui";
import { api, type Priority } from "@/lib/api";
import { textToHtml } from "@/lib/format";
import { compareStates } from "@/lib/issue-query";
import { ALL, useCurrentWorkspace } from "@/lib/workspace";

type SheetKind = "project" | "state" | "priority" | null;

export default function NewIssue() {
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ slug?: string; projectId?: string }>();
  const { slug: current } = useCurrentWorkspace();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });

  const [projectId, setProjectId] = useState<string | undefined>(params.projectId);
  const [stateId, setStateId] = useState<string | undefined>();
  const [priority, setPriority] = useState<Priority>("none");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sheet, setSheet] = useState<SheetKind>(null);

  const project = projects.data?.find((p) => p.id === projectId);
  const slug = project?.workspace_slug ?? params.slug;

  const states = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.states(slug!, projectId!),
    enabled: Boolean(slug && projectId),
  });
  const sortedStates = [...(states.data ?? [])].sort(compareStates);
  // Same default as the web create sheet: the backlog state, else the first.
  const state =
    sortedStates.find((s) => s.id === stateId) ??
    sortedStates.find((s) => s.group === "backlog") ??
    sortedStates[0];

  const create = useMutation({
    mutationFn: () =>
      api.createIssue(slug!, projectId!, {
        name: name.trim(),
        description_html: description.trim() ? textToHtml(description) : undefined,
        priority,
        state_id: state?.id,
      }),
    onSuccess: (issue) => {
      void qc.invalidateQueries({ queryKey: ["project-issues"] });
      void qc.invalidateQueries({ queryKey: ["my-issues"] });
      void qc.invalidateQueries({ queryKey: ["today"] });
      router.replace({
        pathname: "/issue/[slug]/[projectId]/[issueId]",
        params: { slug: slug!, projectId: projectId!, issueId: issue.id },
      });
    },
  });

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ListGroup>
            <ListRow
              icon="folder-outline"
              title={project ? project.name : "Choose a project"}
              subtitle={project?.workspace_name}
              value="Project"
              chevron
              onPress={() => setSheet("project")}
            />
            <ListRow
              left={<StateIcon state={state} size={18} />}
              title={state?.name ?? "—"}
              value="State"
              chevron
              onPress={() => projectId && setSheet("state")}
            />
            <ListRow
              left={<PriorityIcon priority={priority} size={18} />}
              title={PRIORITIES.find((p) => p.value === priority)!.label}
              value="Priority"
              chevron
              onPress={() => setSheet("priority")}
            />
          </ListGroup>

          <Input
            label="Title"
            value={name}
            onChangeText={setName}
            placeholder="What needs doing?"
            autoFocus
            returnKeyType="next"
          />
          <Input
            label="Description"
            labelRight={<MicButton value={description} onChangeText={setDescription} />}
            value={description}
            onChangeText={setDescription}
            placeholder="Context, steps, acceptance criteria…"
            multiline
          />
          <ErrorNote error={create.error ?? projects.error} />
          <Button
            label="Create issue"
            icon="add"
            loading={create.isPending}
            disabled={!name.trim() || !slug || !projectId}
            onPress={() => create.mutate()}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <OptionSheet
        visible={sheet === "project"}
        title="Project"
        onClose={() => setSheet(null)}
        options={(projects.data ?? [])
          .filter((p) => current === ALL || p.workspace_slug === current)
          .map((p) => ({
            key: p.id,
            label: current === ALL ? `${p.name}  ·  ${p.workspace_name}` : p.name,
            selected: p.id === projectId,
          }))}
        onSelect={(id) => {
          setProjectId(id);
          setStateId(undefined);
        }}
      />
      <OptionSheet
        visible={sheet === "state"}
        title="State"
        onClose={() => setSheet(null)}
        options={sortedStates.map((s) => ({
          key: s.id,
          label: s.name,
          selected: s.id === state?.id,
          left: <StateIcon state={s} />,
        }))}
        onSelect={setStateId}
      />
      <OptionSheet
        visible={sheet === "priority"}
        title="Priority"
        onClose={() => setSheet(null)}
        options={PRIORITIES.map((p) => ({
          key: p.value,
          label: p.label,
          selected: p.value === priority,
          left: <PriorityIcon priority={p.value} />,
        }))}
        onSelect={(value) => setPriority(value as Priority)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg },
}));
