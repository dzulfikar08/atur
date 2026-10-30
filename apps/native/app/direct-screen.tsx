import "@/unistyles";

import { DirectScreen } from "@/components/direct/direct-screen";

/** The paired computer's desktop. Needs no account: it is outside the signed-in screens. */
export default function DirectScreenRoute() {
  return <DirectScreen />;
}
