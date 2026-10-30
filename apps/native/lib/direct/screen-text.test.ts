import { expect, test } from "bun:test";

import type { DirectScreenPhase } from "@/lib/direct/screen-controller";
import {
  describeScreenState,
  describeScreenStats,
  SCREEN_PHASE_LABEL,
} from "@/lib/direct/screen-text";

const PHASES = Object.keys(SCREEN_PHASE_LABEL) as DirectScreenPhase[];

test("a refusal shows the server's reason verbatim and offers a retry and the cloud screen", () => {
  const reason = "Screen sharing is not allowed for this phone. Allow it under Settings.";
  const notice = describeScreenState({ phase: "refused", reason, attempt: 0 });
  expect(notice?.body).toBe(reason);
  expect(notice?.canRetry).toBe(true);
  expect(notice?.offerCloud).toBe(true);
});

test("unavailable and ended carry the server's reason too", () => {
  expect(describeScreenState({ phase: "unavailable", reason: "no wayvnc", attempt: 0 })?.body).toBe(
    "no wayvnc",
  );
  expect(describeScreenState({ phase: "ended", reason: "taken over", attempt: 0 })?.body).toBe(
    "taken over",
  );
});

test("an older server cannot be retried, only replaced by the cloud screen", () => {
  const notice = describeScreenState({ phase: "unsupported", reason: "older server", attempt: 0 });
  expect(notice?.canRetry).toBe(false);
  expect(notice?.offerCloud).toBe(true);
  expect(notice?.title).toContain("newer");
});

test("nothing is shown over a live picture or a closed screen", () => {
  expect(describeScreenState({ phase: "ready", reason: "", attempt: 0 })).toBeNull();
  expect(describeScreenState({ phase: "closed", reason: "", attempt: 0 })).toBeNull();
});

test("connecting and reconnecting have no way out of their own", () => {
  for (const phase of ["connecting", "reconnecting"] as const) {
    const notice = describeScreenState({ phase, reason: "", attempt: 2 });
    expect(notice?.canRetry).toBe(false);
    expect(notice?.offerCloud).toBe(false);
  }
  expect(describeScreenState({ phase: "reconnecting", reason: "", attempt: 2 })?.body).toBe(
    "Attempt 2",
  );
});

test("every phase has a bar label", () => {
  for (const phase of PHASES) expect(SCREEN_PHASE_LABEL[phase].length).toBeGreaterThan(0);
});

test("the stats label names the codec, the rate and the bitrate", () => {
  const base = { dropped: 0, decodeMs: 1 };
  expect(describeScreenStats({ ...base, codec: "h264", fps: 29.7, kbps: 840 })).toBe(
    "H.264 · 30 fps · 840 kbit/s",
  );
  expect(describeScreenStats({ ...base, codec: "zrle", fps: 4, kbps: 1500 })).toBe(
    "ZRLE · 4 fps · 1.5 Mbit/s",
  );
  expect(describeScreenStats({ ...base, codec: "vp9", fps: 1, kbps: 10 })).toBe(
    "VP9 · 1 fps · 10 kbit/s",
  );
});
