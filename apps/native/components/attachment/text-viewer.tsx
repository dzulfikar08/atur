import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Mono } from "@/components/ui";

/** Monospace, selectable, scrolling both ways (long lines are not wrapped). */
export function TextViewer({ text }: { text: string }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.vertical}>
      <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
        <Mono style={styles.code} selectable>
          {text}
        </Mono>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  vertical: { padding: theme.spacing.lg },
  code: { fontSize: theme.fontSize.sm, lineHeight: 19 },
}));
