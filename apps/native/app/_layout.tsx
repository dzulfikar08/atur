import "@/unistyles";
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import {
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/manrope";
import { QueryClientProvider } from "@tanstack/react-query";
import { router, Stack, usePathname, useRootNavigationState } from "expo-router";
// expo-router ships its own react-navigation fork; this is its theme context.
// Deep import: the SDK forbids a direct @react-navigation dependency.
import { ThemeProvider } from "expo-router/build/react-navigation/core";
import { DefaultTheme } from "expo-router/build/react-navigation/native/theming/DefaultTheme";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { UnistylesRuntime, useUnistyles } from "react-native-unistyles";

import { AgentNotifications } from "@/components/agent-notifications";
import { usePlanBlocked } from "@/components/plan-gate";
import { UpdateBanner } from "@/components/update-banner";
import { directManager } from "@/lib/direct";
import { startRoute } from "@/lib/direct/start-route";
import { installDiagnostics, setCurrentRoute } from "@/lib/diagnostics";
import { loadThemePref } from "@/lib/theme-pref";
import { queryClient, restoreSession, useSession, type SessionStatus } from "@/lib/session";
import { darkTheme } from "@/theme";

// CI proof builds only: registers the direct-connection run (app/direct-e2e.tsx).
const E2E = process.env.EXPO_PUBLIC_ATUR_E2E === "1";

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash already hidden (web).
});

// Module scope so errors thrown during startup land in the report context too.
installDiagnostics();

export default function RootLayout() {
  const { theme } = useUnistyles();
  const session = useSession();
  const [fontsLoaded] = useFonts({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });
  const pathname = usePathname();

  useEffect(() => {
    setCurrentRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    void restoreSession();
    // "system" (or nothing stored) keeps adaptiveThemes following the OS.
    void loadThemePref().then((pref) => {
      if (pref === "light" || pref === "dark") {
        UnistylesRuntime.setAdaptiveThemes(false);
        UnistylesRuntime.setTheme(pref);
      }
    });
  }, []);

  // Signed out, the saved pairing decides where the app opens, so it is read before the splash
  // goes. Signed in, the direct connection starts when a screen first needs it.
  const direct = useSyncExternalStore(directManager.subscribe, directManager.getSnapshot);
  const anon = session.status === "anon";
  useEffect(() => {
    if (anon) void directManager.start();
  }, [anon]);

  // The saved pairing is read in milliseconds; if it ever is not, the app opens anyway.
  const [pairingWaitOver, setPairingWaitOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPairingWaitOver(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  const ready =
    fontsLoaded && session.status !== "loading" && (!anon || direct.loaded || pairingWaitOver);
  // Once shown, the tree stays: signing out must not blank the app while the pairing is read.
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    if (!ready) return;
    setLaunched(true);
    void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready && !launched) return null;

  const dark = theme.colors.background === darkTheme.colors.background;
  const navTheme = {
    ...DefaultTheme,
    dark,
    colors: {
      ...DefaultTheme.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.background,
      text: theme.colors.foreground,
      border: theme.colors.hairline,
      notification: theme.colors.urgent,
    },
  };
  const hasCredential = direct.state !== "unpaired" && direct.state !== "unsupported";

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={navTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style={dark ? "light" : "dark"} />
          <AppStack status={session.status} hasCredential={hasCredential} />
          <UpdateBanner />
        </GestureHandlerRootView>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * The screens. The account's own are signed-in only; the Direct area (`direct-home`,
 * `direct-pane`, `pair`) is always reachable, with or without an account or an Atur Cloud plan.
 */
function AppStack({ status, hasCredential }: { status: SessionStatus; hasCredential: boolean }) {
  const { theme } = useUnistyles();
  const authed = status === "authed";
  const planBlocked = usePlanBlocked(authed);
  useStartArea(status, hasCredential);

  return (
    <>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTitleStyle: { color: theme.colors.foreground, fontFamily: theme.fonts.bold },
          headerTintColor: theme.colors.foreground,
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Protected guard={authed && !planBlocked}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="project/[slug]/[projectId]" options={{ title: "" }} />
          <Stack.Screen name="issue/[slug]/[projectId]/[issueId]" options={{ title: "" }} />
          <Stack.Screen name="attachment" options={{ title: "" }} />
          <Stack.Screen name="new-issue" options={{ title: "New issue", presentation: "modal" }} />
          <Stack.Screen name="search" options={{ title: "Search" }} />
          <Stack.Screen name="my-issues" options={{ title: "My issues" }} />
          <Stack.Screen name="direct" options={{ title: "Direct connection" }} />
          <Stack.Screen name="pane/[paneId]" options={{ title: "" }} />
          <Stack.Screen name="screen" options={{ headerShown: false, animation: "fade" }} />
        </Stack.Protected>
        <Stack.Protected guard={authed && planBlocked}>
          <Stack.Screen name="plan-required" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!authed}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="direct-home" options={{ title: "Direct" }} />
        <Stack.Screen name="direct-pane/[sessionId]" options={{ title: "" }} />
        <Stack.Screen name="pair" options={{ title: "Pair a computer" }} />
        {E2E ? <Stack.Screen name="direct-e2e" options={{ headerShown: false }} /> : null}
      </Stack>
      {authed && !planBlocked ? <AgentNotifications /> : null}
    </>
  );
}

/**
 * Signed out with a computer already paired: open the Direct area instead of the sign-in screen,
 * once per launch, and only when nothing else (a tapped pairing link) opened the app. Signing in
 * from the Direct area afterwards goes on to the account's screens.
 */
function useStartArea(status: SessionStatus, hasCredential: boolean): void {
  const pathname = usePathname();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const decided = useRef(false);
  const wasAnon = useRef(false);

  useEffect(() => {
    if (!navigationReady) return;
    if (!decided.current) {
      const area = startRoute({ status, hasCredential });
      if (area === "wait") return;
      decided.current = true;
      if (area === "direct" && (pathname === "/login" || pathname === "/")) {
        router.replace("/direct-home");
      }
    } else if (status === "authed" && wasAnon.current) {
      router.replace("/");
    }
    wasAnon.current = status === "anon";
  }, [navigationReady, status, hasCredential, pathname]);
}
