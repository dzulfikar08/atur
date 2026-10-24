import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import { useEffect, useState } from "react";

import { FloatingTabBar, TabBarInsetProvider } from "@/components/floating-tab-bar";
import type { IconName } from "@/components/ui";
import { api } from "@/lib/api";
import { attentionCount } from "@/lib/pane-meta";
import { loadPaneSeen, prunePaneSeen, usePaneSeen } from "@/lib/pane-seen";

const TABS: { name: string; label: string; icon: IconName; outline: IconName }[] = [
  { name: "index", label: "Today", icon: "today", outline: "today-outline" },
  { name: "projects", label: "Projects", icon: "folder", outline: "folder-outline" },
  { name: "inbox", label: "Inbox", icon: "notifications", outline: "notifications-outline" },
  { name: "panes", label: "Panes", icon: "terminal", outline: "terminal-outline" },
  { name: "profile", label: "Profile", icon: "person-circle", outline: "person-circle-outline" },
];

export default function TabLayout() {
  const { data: unread } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: api.unreadCount,
    refetchInterval: 60_000,
  });
  // Same cache entry as the Panes screen, so the badge stays current from any tab.
  const { data: panes } = useQuery({
    queryKey: ["panes"],
    queryFn: api.panes,
    refetchInterval: 10_000,
  });
  const seen = usePaneSeen();
  const [seenLoaded, setSeenLoaded] = useState(false);
  useEffect(() => {
    void loadPaneSeen().then(() => setSeenLoaded(true));
  }, []);
  // Once the persisted acknowledgements are in, forget those the list outgrew
  // so a pane's next done / needs-you counts again.
  useEffect(() => {
    if (seenLoaded && panes) prunePaneSeen(panes);
  }, [seenLoaded, panes]);
  const attention = panes ? attentionCount(panes, seen) : 0;

  return (
    <TabBarInsetProvider>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              tabBarLabel: tab.label,
              tabBarBadge:
                tab.name === "inbox" && unread?.count
                  ? unread.count
                  : tab.name === "panes" && attention > 0
                    ? attention
                    : undefined,
              tabBarIcon: ({ focused, size, color }) => (
                <Ionicons name={focused ? tab.icon : tab.outline} size={size} color={color} />
              ),
            }}
          />
        ))}
      </Tabs>
    </TabBarInsetProvider>
  );
}
