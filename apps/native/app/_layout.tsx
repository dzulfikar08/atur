import "@/unistyles";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import {
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/manrope";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
// expo-router ships its own react-navigation fork; this is its theme context.
// Deep import: the SDK forbids a direct @react-navigation dependency.
import { ThemeProvider } from "expo-router/build/react-navigation/core";
import { DefaultTheme } from "expo-router/build/react-navigation/native/theming/DefaultTheme";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { UnistylesRuntime, useUnistyles } from "react-native-unistyles";

import { loadThemePref } from "@/lib/theme-pref";
import { queryClient, restoreSession, useSession } from "@/lib/session";
import { darkTheme } from "@/theme";

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Splash already hidden (web).
});

export default function RootLayout() {
  const { theme } = useUnistyles();
  const session = useSession();
  const [fontsLoaded] = useFonts({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    JetBrainsMono_500Medium,
  });

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

  const ready = fontsLoaded && session.status !== "loading";
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

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
  const authed = session.status === "authed";

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={navTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style={dark ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: theme.colors.background },
              headerTitleStyle: { color: theme.colors.foreground, fontFamily: theme.fonts.bold },
              headerTintColor: theme.colors.foreground,
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            <Stack.Protected guard={authed}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="project/[slug]/[projectId]" options={{ title: "" }} />
              <Stack.Screen name="issue/[slug]/[projectId]/[issueId]" options={{ title: "" }} />
              <Stack.Screen
                name="new-issue"
                options={{ title: "New issue", presentation: "modal" }}
              />
              <Stack.Screen name="search" options={{ title: "Search" }} />
              <Stack.Screen name="my-issues" options={{ title: "My issues" }} />
            </Stack.Protected>
            <Stack.Protected guard={!authed}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
        </GestureHandlerRootView>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
