import { useEffect, useSyncExternalStore } from "react";

import { directManager } from "@/lib/direct";
import type { DirectSnapshot } from "@/lib/direct/manager";

/** The direct connection's state; mounting the first user starts the manager. */
export function useDirect(): DirectSnapshot {
  useEffect(() => {
    void directManager.start();
  }, []);
  return useSyncExternalStore(directManager.subscribe, directManager.getSnapshot);
}
