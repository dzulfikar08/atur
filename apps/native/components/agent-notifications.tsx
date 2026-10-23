import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { isViewingPane, parseAgentNotification } from "@/lib/agent-notification";
import { syncAgentAlerts } from "@/lib/push";

/**
 * Headless: wires agent push alerts into the app while signed in. Foreground
 * presentation (suppressed when that pane is already on screen), tap and
 * cold-start routing to the pane, pane-list refresh on arrival, and the
 * start-up token re-registration.
 */
export function AgentNotifications() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  // Read from handlers that outlive the render that created them.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    void syncAgentAlerts();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;

    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const agent = parseAgentNotification(notification.request.content.data);
        const visible = !(agent && isViewingPane(pathnameRef.current, agent.paneId));
        return {
          shouldShowBanner: visible,
          shouldShowList: visible,
          shouldPlaySound: visible,
          shouldSetBadge: false,
        };
      },
    });

    // A notification can surface through both the cold-start lookup and the listener.
    const handled = new Set<string>();
    const open = (response: Notifications.NotificationResponse) => {
      const { identifier, content } = response.notification.request;
      if (handled.has(identifier)) return;
      handled.add(identifier);
      const agent = parseAgentNotification(content.data);
      if (!agent) return;
      void queryClient.invalidateQueries({ queryKey: ["panes"] });
      if (isViewingPane(pathnameRef.current, agent.paneId)) return;
      router.push({ pathname: "/pane/[paneId]", params: { paneId: agent.paneId } });
    };

    // Deferred a tick so the navigator has mounted before a cold-start push.
    const coldStart = setTimeout(() => {
      const initial = Notifications.getLastNotificationResponse();
      if (!initial) return;
      open(initial);
      Notifications.clearLastNotificationResponse();
    }, 0);
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    const received = Notifications.addNotificationReceivedListener((notification) => {
      if (parseAgentNotification(notification.request.content.data)) {
        void queryClient.invalidateQueries({ queryKey: ["panes"] });
      }
    });

    return () => {
      clearTimeout(coldStart);
      tapped.remove();
      received.remove();
      Notifications.setNotificationHandler(null);
    };
  }, [queryClient, router]);

  return null;
}
