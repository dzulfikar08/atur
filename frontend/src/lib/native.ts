/**
 * Capacitor native runtime helpers.
 *
 * In the browser this module is inert: `isNative()` is false, the API origin
 * is empty (relative paths keep resolving against the current origin), and the
 * token store is a no-op unless a token is present. In a Capacitor WebView it
 * provides the absolute API origin, bearer-token persistence, and platform
 * bootstrap (status bar, splash screen).
 */
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

const TOKEN_KEY = 'atur.session_token';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

function getCapacitor(): CapacitorGlobal | undefined {
  try {
    return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  } catch {
    return undefined;
  }
}

/** True when running inside a Capacitor native WebView (iOS/Android). */
export function isNative(): boolean {
  return getCapacitor()?.isNativePlatform?.() === true;
}

const envOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim();

/** API origin (no trailing slash). Empty in the browser, absolute in native. */
export const apiOrigin = isNative()
  ? envOrigin?.replace(/\/+$/, '') || 'https://diatur.com'
  : '';

/** Absolute URL for an API/asset path. Browser mode leaves relative paths as-is. */
export function resolveApiUrl(path: string): string {
  if (!apiOrigin || path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${apiOrigin}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Absolute `wss://` URL for a WS path, derived from the API origin host. */
export function resolveWsUrl(path: string): string {
  if (!apiOrigin) return path;
  const host = new URL(apiOrigin).host;
  return `wss://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

export function setSessionToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode etc.) — session just won't persist.
  }
}

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore — nothing to clear.
  }
}

/** Authorization headers for the stored bearer token, if any. */
export function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** One-time native bootstrap: status bar + splash screen. No-op in browser. */
export function initNativePlatform(): void {
  if (!isNative()) return;
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {});
  SplashScreen.hide().catch(() => {});
}
