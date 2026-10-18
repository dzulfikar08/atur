import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Card, Skeleton } from "@/components/ui";

/** Placeholder issue rows, shaped like `IssueRow` (glyph, key, title, meta). */
export function IssueListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading issues">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={16} height={16} radius={8} style={styles.glyph} />
          <View style={styles.body}>
            <Skeleton width={56} height={10} />
            <Skeleton width={i % 3 === 0 ? "92%" : i % 3 === 1 ? "72%" : "84%"} height={14} />
            <Skeleton width="48%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Today: two bucket cards (the stat tiles above them render their own placeholder). */
export function TodaySkeleton() {
  return (
    <View style={styles.stack} accessibilityLabel="Loading today">
      {[0, 1].map((b) => (
        <Card key={b}>
          <View style={styles.bucketHead}>
            <Skeleton width={8} height={8} radius={4} />
            <Skeleton width={110} height={14} />
          </View>
          {[0, 1, 2].map((r) => (
            <View key={r} style={styles.bucketRow}>
              <Skeleton width={8} height={8} radius={4} />
              <Skeleton width={r === 1 ? "58%" : "74%"} height={14} />
              <View style={styles.flex} />
              <Skeleton width={46} height={20} radius={10} />
            </View>
          ))}
        </Card>
      ))}
    </View>
  );
}

/** A hairline card of placeholder rows, for the Projects and Inbox lists. */
export function RowListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card>
      <View accessibilityLabel="Loading">
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={[styles.listRow, i > 0 && styles.listRowBorder]}>
            <Skeleton width={34} height={28} radius={6} />
            <View style={styles.body}>
              <Skeleton width={i % 2 ? "52%" : "68%"} height={14} />
              <Skeleton width="34%" height={10} />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Issue detail: key, title, property grid, description lines, tab strip. */
export function IssueDetailSkeleton() {
  return (
    <View style={styles.detail} accessibilityLabel="Loading issue">
      <Skeleton width={90} height={11} />
      <Skeleton width="88%" height={24} radius={8} />
      <Skeleton width="60%" height={24} radius={8} />
      <View style={styles.propGrid}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={styles.prop}>
            <Skeleton width={60} height={10} />
            <Skeleton height={34} radius={10} />
          </View>
        ))}
      </View>
      <Skeleton height={13} />
      <Skeleton width="94%" height={13} />
      <Skeleton width="70%" height={13} />
      <Skeleton height={36} radius={10} style={styles.tabs} />
      {[0, 1].map((i) => (
        <View key={i} style={styles.commentRow}>
          <Skeleton width={28} height={28} radius={14} />
          <View style={styles.body}>
            <Skeleton width={120} height={11} />
            <Skeleton width="86%" height={13} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  row: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  glyph: { marginTop: 14 },
  body: { flex: 1, gap: 8 },
  stack: { gap: theme.spacing.md },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  listRowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.hairline },
  bucketHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  bucketRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
  },
  detail: { padding: theme.spacing.lg, gap: theme.spacing.md },
  propGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  prop: { width: "47%", gap: 6 },
  tabs: { marginTop: theme.spacing.sm },
  commentRow: { flexDirection: "row", gap: theme.spacing.md },
}));
