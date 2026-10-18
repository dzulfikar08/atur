/**
 * Atur design tokens, ported from apps/app/src/client/index.css.
 *
 * Monochrome graphite: near-white canvas, white cards, near-black primary.
 * Color only carries meaning — state groups, priorities, destructive — so a
 * glance at a list tells you what's moving and what's on fire.
 *
 * State/priority/amber values are the web's `--state-*` / `--priority-*`
 * design tokens (light values are darkened for >=4.5:1 text contrast on
 * white; dark values are the lighter pairs). Never hard-code a state colour:
 * resolve through `stateColor()` so native and web stay in step.
 */
const sharedLight = {
  // State groups + canonical workflow keys (--state-*).
  backlog: "#64748B",
  unstarted: "#4F46E5",
  started: "#2563EB",
  review: "#C2410C",
  needsYou: "#BE185D",
  completed: "#15803D",
  cancelled: "#94A3B8",
  triage: "#BE185D",
  amber: "#B45309",
  // Priorities (--priority-*).
  urgent: "#DC2626",
  high: "#EA580C",
  medium: "#CA8A04",
  low: "#2563EB",
  priorityNone: "#94A3B8",
} as const;

const sharedDark = {
  backlog: "#94A3B8",
  unstarted: "#818CF8",
  started: "#60A5FA",
  review: "#FB923C",
  needsYou: "#F472B6",
  completed: "#4ADE80",
  cancelled: "#64748B",
  triage: "#F472B6",
  amber: "#FBBF24",
  urgent: "#F87171",
  high: "#FB923C",
  medium: "#FBBF24",
  low: "#60A5FA",
  priorityNone: "#64748B",
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
    ...sharedLight,
    // Web surface scale (--surface-elevated / --surface-card / --surface-card-hover).
    surfaceElevated: "#FFFFFF",
    surfaceCard: "#FAFAFA",
    surfaceHover: "#F3F3F3",
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
    ...sharedDark,
    surfaceElevated: "#101013",
    surfaceCard: "#141417",
    surfaceHover: "#1A1A1F",
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

/** Either theme's palette, with string values (the literal types differ per theme). */
export type Palette = { [K in keyof typeof lightTheme.colors]: string };

/**
 * Colour for an issue state: canonical workflow key first (needs_you,
 * need_review, …), then the state group — the same order as the web's
 * `stateColor()` in lib/issueColors.ts. Stored per-state hex colours are
 * deliberately ignored: they predate the palette and fail contrast.
 */
export function stateColor(
  colors: Palette,
  state: { key?: string | null; group?: string | null } | null | undefined,
): string {
  switch (state?.key) {
    case "needs_you":
      return colors.needsYou;
    case "need_review":
      return colors.review;
    case "in_progress":
      return colors.started;
    case "todo":
      return colors.unstarted;
    case "done":
      return colors.completed;
    case "cancelled":
      return colors.cancelled;
  }
  switch (state?.group) {
    case "completed":
      return colors.completed;
    case "cancelled":
      return colors.cancelled;
    case "started":
      return colors.started;
    case "triage":
      return colors.triage;
    default:
      return colors.backlog;
  }
}

/** Colour for a priority value. */
export function priorityColor(colors: Palette, priority: string | null | undefined): string {
  switch (priority) {
    case "urgent":
      return colors.urgent;
    case "high":
      return colors.high;
    case "medium":
      return colors.medium;
    case "low":
      return colors.low;
    default:
      return colors.priorityNone;
  }
}
