import { useEffect, type CSSProperties } from "react";
import { holdBootSplash, releaseInitialBootHold } from "@/lib/boot-splash";

/**
 * Full-screen loading state. Renders nothing itself: it holds the #boot splash
 * from index.html open with `label`, so consecutive loaders during boot read as
 * one screen whose caption advances.
 */
export function AppLoader({ label = "Loading Atur" }: { label?: string }) {
  useEffect(() => holdBootSplash(label), [label]);
  return null;
}

/** Mount once at the root: hands the splash over to React after first commit. */
export function BootSplashRelease() {
  useEffect(releaseInitialBootHold, []);
  return null;
}

// Slightly longer than the splash's 150ms: in-app route chunks usually resolve
// fast, and a loader that flashes for one frame is worse than none.
const contentEnter = { "--boot-enter": "200ms" } as CSSProperties;

/** Loading state inside the app shell; the sidebar stays put around it. */
export function ContentLoader({ label = "Loading page" }: { label?: string }) {
  return (
    <div className="boot boot--content" role="status" aria-live="polite" style={contentEnter}>
      <div className="boot-progress">
        <div className="boot-bar" />
        <p className="boot-label">{label}</p>
      </div>
    </div>
  );
}
