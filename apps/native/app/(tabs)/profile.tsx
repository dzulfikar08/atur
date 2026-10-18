import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { StyleSheet, UnistylesRuntime, useUnistyles } from "react-native-unistyles";

import { useReportSheet } from "@/components/report-sheet";
import {
  Avatar,
  Button,
  Chip,
  ErrorNote,
  Input,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  SectionTitle,
  Sheet,
  Text,
} from "@/components/ui";
import { DELETE_ACCOUNT_INFO_URL, DELETE_CONFIRMATION, deleteAccount } from "@/lib/account";
import { api } from "@/lib/api";
import { SERVER_URL } from "@/lib/config";
import { displayName } from "@/lib/format";
import { OTA_ENABLED, useOtaUpdate, type OtaPhase } from "@/lib/ota";
import { endSession } from "@/lib/session";
import { loadThemePref, saveThemePref, type ThemePref } from "@/lib/theme-pref";
import { setCurrentWorkspace, useCurrentWorkspace } from "@/lib/workspace";

const OTA_STATUS: Record<OtaPhase, string> = {
  disabled: "Off in this build",
  idle: "Up to date",
  checking: "Checking…",
  downloading: "Downloading…",
  ready: "Update ready — restart to apply",
  error: "Could not check",
};

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function Profile() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { theme } = useUnistyles();
  const { slug: currentSlug } = useCurrentWorkspace();
  const [themePref, setThemePref] = useState<ThemePref>("system");
  const report = useReportSheet();
  const ota = useOtaUpdate();
  const otaBusy = ota.phase === "checking" || ota.phase === "downloading";

  useEffect(() => {
    void loadThemePref().then((pref) => setThemePref(pref ?? "system"));
  }, []);

  const applyTheme = (pref: ThemePref) => {
    setThemePref(pref);
    void saveThemePref(pref);
    if (pref === "system") {
      UnistylesRuntime.setAdaptiveThemes(true);
    } else {
      // setTheme throws while adaptiveThemes is on.
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme(pref);
    }
  };

  const signOut = useMutation({
    // Revoke server-side when reachable; the local session ends regardless.
    mutationFn: () => api.signOut().catch(() => undefined),
    onSettled: () => endSession(),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const deleteAccountMutation = useMutation({
    // On success deleteAccount() ends the session and the root layout swaps to
    // the login screen, so there is nothing to close or navigate here.
    mutationFn: deleteAccount,
  });
  const closeDelete = () => {
    setDeleteOpen(false);
    setConfirmText("");
    deleteAccountMutation.reset();
  };

  const name = me.data ? displayName(me.data) : "";

  return (
    <Screen>
      <PageHeader title="Profile" />
      <ErrorNote error={me.error} />
      {me.data ? (
        <View style={styles.identity}>
          <Avatar name={name} uri={me.data.avatar} size={56} />
          <View style={styles.flex}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.email}>{me.data.email}</Text>
          </View>
        </View>
      ) : null}

      <SectionTitle title="Workspaces" />
      <ListGroup>
        {(me.data?.workspaces ?? []).map((w) => (
          <ListRow
            key={w.id}
            left={<Avatar name={w.name} uri={w.logo} size={28} square />}
            title={w.name}
            subtitle={w.slug}
            right={
              w.slug === currentSlug ? (
                <Ionicons name="checkmark" size={18} color={theme.colors.foreground} />
              ) : undefined
            }
            onPress={() => setCurrentWorkspace(w.slug)}
          />
        ))}
      </ListGroup>

      <SectionTitle title="Appearance" />
      <View style={styles.chips}>
        {THEMES.map((t) => (
          <Chip
            key={t.value}
            label={t.label}
            selected={themePref === t.value}
            onPress={() => applyTheme(t.value)}
          />
        ))}
      </View>

      <SectionTitle title="Help" />
      <ListGroup>
        <ListRow
          icon="chatbubble-ellipses-outline"
          title="Send feedback / report a bug"
          subtitle="Share an idea, a problem or a question"
          chevron
          onPress={() => void report.open()}
        />
      </ListGroup>
      {report.sheet}

      {OTA_ENABLED ? (
        <>
          <SectionTitle title="App updates" />
          <ListGroup>
            <ListRow
              icon="cloud-download-outline"
              title="Status"
              value={
                ota.phase === "downloading" && ota.percent !== null
                  ? `Downloading ${ota.percent}%`
                  : OTA_STATUS[ota.phase]
              }
            />
            <ListRow icon="git-branch-outline" title="Channel" value={ota.channel ?? "—"} />
            <ListRow
              icon="cube-outline"
              title="Running"
              value={
                ota.embedded || !ota.updateId
                  ? "Built into the app"
                  : `${ota.updateId.slice(0, 8)} · ${ota.createdAt?.toISOString().slice(0, 10) ?? ""}`
              }
            />
            <ListRow
              icon="finger-print-outline"
              title="Runtime"
              value={ota.runtimeVersion?.slice(0, 8) ?? "—"}
            />
            <ListRow
              icon="refresh-outline"
              title={otaBusy ? "Checking…" : "Check for updates"}
              chevron
              onPress={otaBusy ? undefined : () => void ota.check()}
            />
            {ota.phase === "ready" ? (
              <ListRow
                icon="reload-outline"
                title="Restart to update"
                chevron
                onPress={() => void ota.restart()}
              />
            ) : null}
          </ListGroup>
        </>
      ) : null}

      <SectionTitle title="About" />
      <ListGroup>
        <ListRow
          icon="globe-outline"
          title="Open Atur on the web"
          subtitle={SERVER_URL.replace(/^https?:\/\//, "")}
          chevron
          onPress={() => void WebBrowser.openBrowserAsync(SERVER_URL)}
        />
        <ListRow
          icon="information-circle-outline"
          title="Version"
          value={Constants.expoConfig?.version ?? "–"}
        />
      </ListGroup>

      <ListGroup>
        <ListRow
          icon="log-out-outline"
          title={signOut.isPending ? "Signing out…" : "Sign out"}
          destructive
          onPress={() => signOut.mutate()}
        />
      </ListGroup>

      <ListGroup>
        <ListRow
          icon="trash-outline"
          title="Delete account"
          subtitle="Permanently erase your account and data"
          destructive
          onPress={() => setDeleteOpen(true)}
        />
      </ListGroup>

      <Sheet visible={deleteOpen} title="Delete account" onClose={closeDelete}>
        <View style={styles.deleteForm}>
          <Text style={styles.deleteBody}>
            This permanently deletes your Atur account and signs you out everywhere. Your profile,
            sign-in methods and API keys are erased. Workspaces you own pass to another member, or
            are deleted if you are the only one in them. This can't be undone.
          </Text>
          <Input
            label={`Type ${DELETE_CONFIRMATION} to confirm`}
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={DELETE_CONFIRMATION}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <ErrorNote error={deleteAccountMutation.error} />
          <Button
            variant="destructive"
            icon="trash-outline"
            label="Delete my account"
            loading={deleteAccountMutation.isPending}
            disabled={confirmText.trim() !== DELETE_CONFIRMATION}
            onPress={() => deleteAccountMutation.mutate()}
          />
          <Button
            variant="ghost"
            label="What gets deleted?"
            onPress={() => void WebBrowser.openBrowserAsync(DELETE_ACCOUNT_INFO_URL)}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  name: { fontSize: theme.fontSize.lg, fontFamily: theme.fonts.bold },
  email: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, marginTop: 2 },
  chips: { flexDirection: "row", gap: theme.spacing.sm },
  deleteBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  deleteForm: { gap: theme.spacing.md, paddingBottom: theme.spacing.sm },
}));
