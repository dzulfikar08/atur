import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { StyleSheet, UnistylesRuntime, useUnistyles } from "react-native-unistyles";

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
import { IS_PLAY_BUILD } from "@/lib/distribution";
import { displayName } from "@/lib/format";
import { endSession } from "@/lib/session";
import { loadThemePref, saveThemePref, type ThemePref } from "@/lib/theme-pref";
import { setCurrentWorkspace, useCurrentWorkspace } from "@/lib/workspace";

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

      <SectionTitle title="About" />
      <ListGroup>
        <ListRow
          icon="globe-outline"
          title="Open Atur on the web"
          subtitle={SERVER_URL.replace(/^https?:\/\//, "")}
          chevron
          onPress={() => void WebBrowser.openBrowserAsync(SERVER_URL)}
        />
        {Platform.OS === "android" && !IS_PLAY_BUILD ? (
          <ListRow
            icon="download-outline"
            title="Download latest Android app"
            subtitle="Install over this one to update — you stay signed in"
            chevron
            // System browser, not a Custom Tab: it hands the APK to the
            // download manager / package installer. The link is public, so
            // no web sign-in (which would end this app's session) is needed.
            onPress={() => void Linking.openURL(`${SERVER_URL}/public/downloads/android`)}
          />
        ) : null}
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
