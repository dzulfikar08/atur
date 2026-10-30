import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { directManager } from "@/lib/direct";
import {
  openDirectScreen,
  type DirectScreenHandle,
  type DirectScreenOptions,
  type DirectScreenState,
} from "@/lib/direct/screen-controller";

const IDLE: DirectScreenState = {
  phase: "connecting",
  width: 0,
  height: 0,
  name: "",
  reason: "",
  stats: null,
  clipboard: "",
  h264: false,
  viewOnly: false,
  attempt: 0,
};

const never = () => () => {};

/**
 * The direct screen of the paired computer while `options` is set: opened on mount, closed on
 * unmount. `options` is read once (when it first becomes non-null); change view-only through the
 * handle.
 */
export function useDirectScreen(options: DirectScreenOptions | null): {
  screen: DirectScreenHandle | null;
  state: DirectScreenState;
} {
  const enabled = options !== null;
  // The starting point only: later changes go through the handle.
  const start = useRef(options);
  start.current = options;
  const [screen, setScreen] = useState<DirectScreenHandle | null>(null);

  useEffect(() => {
    const first = start.current;
    if (!enabled || !first) return;
    const opened = openDirectScreen(directManager, first);
    setScreen(opened);
    return () => {
      opened.close();
      setScreen(null);
    };
  }, [enabled]);

  const subscribe = useMemo(() => screen?.subscribe ?? never, [screen]);
  const read = useMemo(() => screen?.getState ?? (() => IDLE), [screen]);
  const state = useSyncExternalStore(subscribe, read);
  return { screen, state };
}
