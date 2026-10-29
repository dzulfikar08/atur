import "@/unistyles";
import { useLocalSearchParams } from "expo-router";

import { PaneScreen } from "@/components/terminal/pane-screen";

export default function PaneRoute() {
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  return paneId ? <PaneScreen paneId={paneId} /> : null;
}
