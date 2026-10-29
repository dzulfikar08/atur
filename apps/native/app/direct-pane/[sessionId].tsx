import "@/unistyles";
import { useLocalSearchParams } from "expo-router";

import { PaneScreen } from "@/components/terminal/pane-screen";
import { directPaneId } from "@/lib/direct/transport-choice";

/** A terminal on the paired computer. Needs no account: it is outside the signed-in screens. */
export default function DirectPaneRoute() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return sessionId ? <PaneScreen paneId={directPaneId(sessionId)} /> : null;
}
