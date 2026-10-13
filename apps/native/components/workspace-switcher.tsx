import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Avatar, OptionSheet, Text } from "@/components/ui";
import { ALL, setCurrentWorkspace, useCurrentWorkspace } from "@/lib/workspace";

/** Workspace pill (logo + name + chevron) that opens the switcher sheet, like the web sidebar. */
export function WorkspaceSwitcher() {
  const { theme } = useUnistyles();
  const { slug, workspace, workspaces } = useCurrentWorkspace();
  const [open, setOpen] = useState(false);
  const label = workspace?.name ?? "All workspaces";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Workspace: ${label}. Switch workspace`}
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        {workspace ? (
          <Avatar name={workspace.name} uri={workspace.logo} size={24} square />
        ) : (
          <View style={styles.allIcon}>
            <Ionicons name="layers-outline" size={15} color={theme.colors.foreground} />
          </View>
        )}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name="chevron-down" size={16} color={theme.colors.mutedForeground} />
      </Pressable>
      <OptionSheet
        visible={open}
        title="Switch workspace"
        onClose={() => setOpen(false)}
        options={[
          {
            key: ALL,
            label: "All workspaces",
            selected: slug === ALL,
            left: (
              <View style={styles.allIcon}>
                <Ionicons name="layers-outline" size={15} color={theme.colors.foreground} />
              </View>
            ),
          },
          ...workspaces.map((w) => ({
            key: w.slug,
            label: w.name,
            selected: w.slug === slug,
            left: <Avatar name={w.name} uri={w.logo} size={24} square />,
          })),
        ]}
        onSelect={setCurrentWorkspace}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    height: 38,
    paddingLeft: 7,
    paddingRight: theme.spacing.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
  },
  pressed: { opacity: 0.6 },
  label: { flexShrink: 1, fontSize: theme.fontSize.sm, fontFamily: theme.fonts.bold },
  allIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
}));
