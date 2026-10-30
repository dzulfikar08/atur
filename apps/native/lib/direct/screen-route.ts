import type { DirectSnapshot } from "@/lib/direct/manager";

// Which screen the Panes tab's Screen button and the Direct area open: the desktop straight from
// the paired computer when it is connected and offers screen sharing, else Atur Cloud's.

export type ScreenRoute = "/direct-screen" | "/screen";

/** Whether the computer is connected and its server has the screen feature. */
export function directScreenAvailable(
  snapshot: Pick<DirectSnapshot, "state" | "connection">,
): boolean {
  return snapshot.state === "connected" && snapshot.connection?.screen === true;
}

/**
 * The route for the Screen button, or null for no button: Direct when it can, else the cloud
 * screen, which the server only lets the platform owner use.
 */
export function screenRoute(
  snapshot: Pick<DirectSnapshot, "state" | "connection">,
  owner: boolean,
): ScreenRoute | null {
  if (directScreenAvailable(snapshot)) return "/direct-screen";
  return owner ? "/screen" : null;
}
