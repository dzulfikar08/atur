/**
 * Lightweight haptics helpers wrapping @capacitor/haptics.
 * On non-Capacitor environments (browser) these are no-ops.
 */
import { Haptics, ImpactStyle } from '@capacitor/haptics';

let capacitorAvailable = false;
try {
  // Capacitor.platform is only defined in native runtime
  const win = window as unknown as { Capacitor?: { platform?: string } };
  capacitorAvailable = !!win.Capacitor?.platform;
} catch {
  capacitorAvailable = false;
}

/** Light haptic — bottom sheet open/close, subtle feedback */
export function hapticLight() {
  if (!capacitorAvailable) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

/** Medium haptic — pull-to-refresh trigger, state changes, drag start/drop */
export function hapticMedium() {
  if (!capacitorAvailable) return;
  Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

/** Heavy haptic — destructive actions */
export function hapticHeavy() {
  if (!capacitorAvailable) return;
  Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
}
