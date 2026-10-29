import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Text, View } from "react-native";

import { runDirectE2E } from "@/lib/direct/e2e";

// Proof run for CI: only reachable in builds made with EXPO_PUBLIC_ATUR_E2E=1 (app/_layout.tsx
// registers the route only then). `atur://direct-e2e?link=<pairing link>` starts it; the lines it
// logs under ATUR_E2E are what scripts/e2e-direct-android.sh reads.
const ENABLED = process.env.EXPO_PUBLIC_ATUR_E2E === "1";

export default function DirectE2E() {
  // A release build without the flag must not run this for a crafted atur:// link.
  if (!ENABLED) return <Redirect href="/" />;
  return <Run />;
}

function Run() {
  const { link } = useLocalSearchParams<{ link?: string }>();
  const [lines, setLines] = useState<string[]>([]);
  const started = useRef(false);
  const cycles = useRef(0);

  useEffect(() => {
    // One background -> active round trip is one cycle.
    let wasBackground = false;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && wasBackground) cycles.current += 1;
      wasBackground = next !== "active";
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!link || started.current) return;
    started.current = true;
    const say = (line: string) => {
      console.log(line);
      setLines((previous) => [...previous.slice(-60), line]);
    };
    void runDirectE2E(link, say, () => cycles.current).then((report) => {
      say(`ATUR_E2E RESULT ${report.ok ? "PASS" : "FAIL"} ${JSON.stringify(report.metrics)}`);
    });
  }, [link]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000", paddingTop: 48, paddingHorizontal: 8 }}>
      <ScrollView>
        {lines.map((line, index) => (
          <Text key={index} style={{ color: "#9f9", fontSize: 11, fontFamily: "monospace" }}>
            {line.replace(/^ATUR_E2E /, "")}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}
