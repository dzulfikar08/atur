import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { FileCard } from "@/components/attachment/file-card";
import type { AttachmentActions } from "@/components/attachment/use-attachment-actions";
import { Skeleton } from "@/components/ui";
import { fetchAttachmentText, TooLargeError, type AttachmentRef } from "@/lib/attachment-file";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/file-kind";

/**
 * Loads a text attachment with the bearer token and hands the string to
 * `children`. Files past TEXT_PREVIEW_MAX_BYTES are never fetched: the card
 * offers the download/share buttons instead.
 */
export function TextPreview({
  att,
  actions,
  children,
}: {
  att: AttachmentRef;
  actions: AttachmentActions;
  children: (text: string) => ReactNode;
}) {
  const tooBig = att.size != null && att.size > TEXT_PREVIEW_MAX_BYTES;
  const text = useQuery({
    queryKey: ["attachment-text", att.url],
    queryFn: () => fetchAttachmentText(att),
    enabled: !tooBig,
    retry: false,
    staleTime: Infinity,
  });

  if (tooBig || text.error instanceof TooLargeError) {
    return (
      <FileCard
        att={att}
        actions={actions}
        message="This file is too large to preview. Open it in another app instead."
      />
    );
  }
  if (text.error) {
    return <FileCard att={att} actions={actions} message={text.error.message} />;
  }
  if (text.data === undefined) {
    return (
      <View style={styles.skeleton} accessibilityLabel="Loading file">
        {[92, 70, 84, 56, 78].map((w, i) => (
          <Skeleton key={i} width={`${w}%`} height={12} />
        ))}
      </View>
    );
  }
  return <>{children(text.data)}</>;
}

const styles = StyleSheet.create((theme) => ({
  skeleton: { padding: theme.spacing.lg, gap: theme.spacing.md },
}));
