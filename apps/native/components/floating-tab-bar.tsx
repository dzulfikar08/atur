import type { BottomTabBarProps } from "expo-router/js-tabs";
import { CommonActions } from "expo-router/react-navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

/** Gap between the pill and the screen edges and, without a home indicator, the bottom. */
const MARGIN_X = 16;
const GAP_BOTTOM = 8;
/**
 * iOS: the home indicator's inset (34 pt) is mostly empty space. Sitting the
 * pill fully above it made the bar ride too high, so it tucks this far into
 * the inset (the indicator itself stays clear of the pill).
 */
const IOS_INSET_TUCK = 14;

/** Bottom offset of the pill above the screen edge. */
function bottomOffset(inset: number): number {
  if (Platform.OS === "ios") return Math.max(inset - IOS_INSET_TUCK, GAP_BOTTOM);
  return inset + GAP_BOTTOM;
}

/** True while the Android keyboard is up: the window resizes with it, so the bar would ride above it. */
function useAndroidKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

const TabBarInsetContext = createContext<{ inset: number; setInset: (h: number) => void }>({
  inset: 0,
  setInset: () => {},
});

/** Holds the height the floating bar covers at the bottom of tab screens. */
export function TabBarInsetProvider({ children }: { children: ReactNode }) {
  const [inset, setInset] = useState(0);
  const value = useMemo(() => ({ inset, setInset }), [inset]);
  return <TabBarInsetContext.Provider value={value}>{children}</TabBarInsetContext.Provider>;
}

/**
 * Bottom space the floating tab bar covers (0 outside the tabs). Scrolling
 * screens pad the end of their content by it so the last row can scroll
 * fully above the bar; bottom-anchored buttons sit above it.
 */
export function useTabBarInset(): number {
  return useContext(TabBarInsetContext).inset;
}

/**
 * Floating tab bar (after JoyoFit's): a rounded pill inset from the screen
 * edges, the active tab on a muted background. It is absolutely positioned
 * over the screens, so content scrolls underneath it; it reports the height
 * it covers (`useTabBarInset`) for screens to pad by.
 */
export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { theme } = useUnistyles();
  const keyboardOpen = useAndroidKeyboardOpen();
  const { setInset } = useContext(TabBarInsetContext);
  useEffect(() => () => setInset(0), [setInset]);
  useEffect(() => {
    if (keyboardOpen) setInset(0);
  }, [keyboardOpen, setInset]);
  if (keyboardOpen) return null;

  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => setInset(Math.ceil(e.nativeEvent.layout.height))}
      style={[styles.strip, { paddingBottom: bottomOffset(insets.bottom) }]}
    >
      <View accessibilityRole="tablist" style={styles.pill}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = index === state.index;
          const color = focused ? theme.colors.foreground : theme.colors.mutedForeground;
          const label = typeof options.tabBarLabel === "string" ? options.tabBarLabel : route.name;
          const badge = options.tabBarBadge;
          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.dispatch({ ...CommonActions.navigate(route), target: state.key });
            }
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={badge ? `${label}, ${badge}` : label}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
              style={({ pressed }) => [
                styles.item,
                focused && styles.itemActive,
                pressed && styles.itemPressed,
              ]}
            >
              <View>
                {options.tabBarIcon?.({ focused, color, size: 24 })}
                {badge !== undefined && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                )}
              </View>
              <Text numberOfLines={1} style={[styles.label, { color }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: MARGIN_X,
    paddingTop: GAP_BOTTOM,
  },
  pill: {
    flexDirection: "row",
    padding: 6,
    gap: 2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
    // One soft lift (iOS shadow / Android elevation): the pill floats over the page.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  item: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 22,
  },
  itemActive: { backgroundColor: theme.colors.muted },
  itemPressed: { opacity: 0.7 },
  label: { fontSize: 11, fontFamily: theme.fonts.medium },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.urgent,
  },
  badgeText: { fontSize: 10, color: "#fff", fontFamily: theme.fonts.medium },
}));
