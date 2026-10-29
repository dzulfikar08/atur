import type { DirectNetwork } from "@/lib/direct/manager";

/**
 * Tells the manager when the phone's network changed, through `expo-network`. The module is loaded
 * on demand and a failure to load it is ignored: a binary built before the dependency was added has
 * no native side for it, and a bundle updated over the air must still start there (the manager then
 * relies on the app returning to the front and on its own timer).
 */
export function createNetworkObserver(): DirectNetwork {
  return {
    subscribe(listener) {
      let removed = false;
      let subscription: { remove(): void } | null = null;
      import("expo-network")
        .then((Network) => {
          if (!removed) subscription = Network.addNetworkStateListener(() => listener());
        })
        .catch(() => {});
      return () => {
        removed = true;
        subscription?.remove();
        subscription = null;
      };
    },
  };
}
