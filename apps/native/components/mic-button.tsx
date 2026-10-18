import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Alert, Animated, Easing, Linking, Platform, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { useDictation } from "@/lib/dictation";
import { DICTATION_LOCALES } from "@/lib/dictation-text";

/**
 * Dictation for a text field: tap to listen, tap again (or pause) to stop.
 * Speech lands in the field live; `value`/`onChangeText` are the field's own.
 * The small ID/EN chip switches the recognition language.
 */
export function MicButton({
  value,
  onChangeText,
  disabled,
}: {
  value: string;
  onChangeText: (text: string) => void;
  disabled?: boolean;
}) {
  const { theme } = useUnistyles();
  const { state, error, lang, setLang, toggle } = useDictation(value, onChangeText);
  const listening = state === "listening" || state === "starting";
  const unsupported = state === "unsupported";

  // Pulse while the microphone is open.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!listening) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  // Errors (denied, language pack missing, ...) surface once, not as layout.
  const shownError = useRef<string | null>(null);
  useEffect(() => {
    if (!error || error === shownError.current) return;
    shownError.current = error;
    if (state === "denied") {
      Alert.alert("Dictation is off", error, [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ]);
    } else {
      Alert.alert("Dictation", error);
    }
  }, [error, state]);
  useEffect(() => {
    if (!error) shownError.current = null;
  }, [error]);

  const onPress = () => {
    if (unsupported) {
      Alert.alert(
        "Dictation unavailable",
        "Speech input isn't available in the browser build. Use the iOS or Android app.",
      );
      return;
    }
    void Haptics.selectionAsync().catch(() => {});
    toggle();
  };

  const nextLang =
    DICTATION_LOCALES[(DICTATION_LOCALES.indexOf(lang) + 1) % DICTATION_LOCALES.length]!;

  return (
    <View style={styles.row}>
      {listening ? <Text style={styles.listening}>Listening…</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Dictation language ${lang === "id-ID" ? "Indonesian" : "English"}, tap to switch`}
        disabled={listening || unsupported}
        onPress={() => setLang(nextLang)}
        hitSlop={6}
        style={[styles.lang, (listening || unsupported) && styles.dim]}
      >
        <Text style={styles.langText}>{lang === "id-ID" ? "ID" : "EN"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? "Stop dictation" : "Start dictation"}
        accessibilityState={{ disabled, busy: listening }}
        disabled={disabled}
        onPress={onPress}
        hitSlop={6}
        style={({ pressed }) => [
          styles.button,
          listening && styles.buttonActive,
          (disabled || unsupported) && styles.dim,
          pressed && styles.pressed,
        ]}
      >
        {listening ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [
                  { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) },
                ],
              },
            ]}
          />
        ) : null}
        <Ionicons
          name={
            listening
              ? "stop"
              : state === "denied" || unsupported
                ? "mic-off-outline"
                : "mic-outline"
          }
          size={19}
          color={listening ? theme.colors.destructiveForeground : theme.colors.foreground}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  listening: { fontSize: theme.fontSize.sm, color: theme.colors.destructive },
  lang: {
    minWidth: 30,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  langText: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    color: theme.colors.mutedForeground,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonActive: { backgroundColor: theme.colors.destructive },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.destructive,
  },
  dim: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
}));
