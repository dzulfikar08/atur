import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "react-native-unistyles";

import type { IconName } from "@/components/ui";
import { api } from "@/lib/api";

const TABS: { name: string; label: string; icon: IconName; outline: IconName }[] = [
  { name: "index", label: "Today", icon: "today", outline: "today-outline" },
  { name: "projects", label: "Projects", icon: "folder", outline: "folder-outline" },
  { name: "inbox", label: "Inbox", icon: "notifications", outline: "notifications-outline" },
  { name: "panes", label: "Panes", icon: "terminal", outline: "terminal-outline" },
  { name: "profile", label: "Profile", icon: "person-circle", outline: "person-circle-outline" },
];

export default function TabLayout() {
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const { data: unread } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: api.unreadCount,
    refetchInterval: 60_000,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.foreground,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.hairline,
          height: 66 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontFamily: theme.fonts.medium },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            tabBarLabel: tab.label,
            tabBarBadge: tab.name === "inbox" && unread?.count ? unread.count : undefined,
            tabBarBadgeStyle: { backgroundColor: theme.colors.urgent, fontSize: 10 },
            tabBarIcon: ({ focused, size, color }) => (
              <Ionicons name={focused ? tab.icon : tab.outline} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
