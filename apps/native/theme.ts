/**
 * Atur design tokens, ported from apps/app/src/client/index.css.
 *
 * Monochrome graphite: near-white canvas, white cards, near-black primary.
 * Color only carries meaning — state groups, priorities, destructive — so a
 * glance at a list tells you what's moving and what's on fire.
 */
const shared = {
  // State groups (MobileIssueCard STATE_DOT_COLORS).
  backlog: "#9CA3AF",
  unstarted: "#60A5FA",
  started: "#FBBF24",
  completed: "#34D399",
  cancelled: "#F87171",
  triage: "#C084FC",
  // Priorities (MobileIssueCard PRIORITY_DOTS).
  urgent: "#EF4444",
  high: "#F97316",
  medium: "#EAB308",
  low: "#3B82F6",
} as const;

const scale = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 36 },
  radius: { sm: 6, md: 10, lg: 14, xl: 18, pill: 999 },
  fontSize: { xs: 11, sm: 13, base: 15, md: 16, lg: 18, xl: 22, title: 28 },
  fonts: {
    regular: "Manrope_500Medium",
    medium: "Manrope_600SemiBold",
    bold: "Manrope_700Bold",
    heavy: "Manrope_800ExtraBold",
    mono: "JetBrainsMono_500Medium",
  },
} as const;

export const lightTheme = {
  colors: {
    ...shared,
    background: "#FAFAFA",
    card: "#FFFFFF",
    foreground: "#0D0D0D",
    muted: "#F2F2F2",
    mutedForeground: "#666666",
    accent: "#F0F0F0",
    hairline: "#E1E1E1",
    overlay: "rgba(13,13,13,0.45)",
    primary: "#161616",
    primaryForeground: "#FAFAFA",
    destructive: "#DC2626",
    destructiveForeground: "#FFFFFF",
    destructiveSoft: "#FEE2E2",
  },
  ...scale,
} as const;

export const darkTheme = {
  colors: {
    ...shared,
    background: "#0C0C0C",
    card: "#151515",
    foreground: "#F5F5F5",
    muted: "#232323",
    mutedForeground: "#989898",
    accent: "#262626",
    hairline: "rgba(255,255,255,0.09)",
    overlay: "rgba(0,0,0,0.6)",
    primary: "#E4E4E4",
    primaryForeground: "#161616",
    destructive: "#F87171",
    destructiveForeground: "#161616",
    destructiveSoft: "#3B1515",
  },
  ...scale,
} as const;
