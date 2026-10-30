import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Text, View } from "react-native";

import {
  runDirectE2E,
  runLossyE2E,
  runScrollE2E,
  type E2EScenario,
  type ScrollOptions,
} from "@/lib/direct/e2e";

// Proof run for CI: only reachable in builds made with EXPO_PUBLIC_ATUR_E2E=1 (app/_layout.tsx
// registers the route only then). `atur://direct-e2e?link64=<base64url pairing link>` starts it (the link
// has & and ? in it, which a deep link query would split); `&scenario=lossy` plays the lossy-link
// scenario (phase 3) instead of the scripted one, `&scenario=scroll` the scrollback scenario
// (phase 4), which ends by opening the app's own pane screen for the host to scroll; phase 5 plays it
// again with `&agent=1` (the workload runs as `omp`: the pane has the prompt composer), `&late=1` (the
// pane screen opens before the workload starts), `&failreads=N` (the pane screen's first N scrollback
// reads fail) or `&wide=1` (a second client lays the pane out wide). The lines it logs under ATUR_E2E
// are what
// scripts/e2e-direct-android.sh reads.
const ENABLED = process.env.EXPO_PUBLIC_ATUR_E2E === "1";

export default function DirectE2E() {
  // A release build without the flag must not run this for a crafted atur:// link.
  if (!ENABLED) return <Redirect href="/" />;
  return <Run />;
}

function Run() {
  const {
    link64,
    scenario: scenarioParam,
    agent,
    late,
    failreads,
    wide,
  } = useLocalSearchParams<{
    link64?: string;
    scenario?: string;
    agent?: string;
    late?: string;
    failreads?: string;
    wide?: string;
  }>();
  const scroll: ScrollOptions = {
    agent: agent === "1",
    late: late === "1",
    failReads: Number(failreads) > 0 ? Number(failreads) : 0,
    wide: wide === "1",
  };
  const scenario: E2EScenario =
    scenarioParam === "lossy" ? "lossy" : scenarioParam === "scroll" ? "scroll" : "base";
  const link = link64 ? decodeLink(link64) : undefined;
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
    const run =
      scenario === "lossy"
        ? runLossyE2E(link, say)
        : scenario === "scroll"
          ? runScrollE2E(
              link,
              say,
              (session) =>
                router.push({
                  pathname: "/direct-pane/[sessionId]",
                  params: { sessionId: session },
                }),
              scroll,
            )
          : runDirectE2E(link, say, () => cycles.current);
    void run.then((report) => {
      const name = scenario === "base" ? "" : `${scenario} `;
      say(
        `ATUR_E2E RESULT ${name}${report.ok ? "PASS" : "FAIL"} ${JSON.stringify(report.metrics)}`,
      );
    });
  }, [link, scenario]);

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

/** base64url without padding, as scripts/e2e-direct-android.sh writes it. */
function decodeLink(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
}
