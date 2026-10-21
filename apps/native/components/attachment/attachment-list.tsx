import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Image, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { KIND_ICON } from "@/components/attachment/kind-icon";
import { ErrorNote, ListGroup, ListRow, SectionTitle, Skeleton } from "@/components/ui";
import { api, assetSource, type IssueAttachment } from "@/lib/api";
import { fileKind, formatBytes } from "@/lib/file-kind";

function AttachmentIcon({ attachment }: { attachment: IssueAttachment & { url: string } }) {
  const { theme } = useUnistyles();
  const kind = fileKind(attachment.attributes?.type, attachment.attributes?.name);
  return (
    <View style={styles.thumb}>
      {kind === "image" ? (
        <Image
          source={assetSource(attachment.url)}
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          style={styles.thumbImage}
        />
      ) : (
        <Ionicons name={KIND_ICON[kind]} size={20} color={theme.colors.mutedForeground} />
      )}
    </View>
  );
}

/** The issue's files, one row each; tapping opens the in-app viewer. */
export function AttachmentList({
  slug,
  projectId,
  issueId,
  count,
}: {
  slug: string;
  projectId: string;
  issueId: string;
  /** `included.counts.attachments`; the list is only fetched when there is something to list. */
  count: number;
}) {
  const attachments = useQuery({
    queryKey: ["attachments", slug, projectId, issueId],
    queryFn: () => api.attachments(slug, projectId, issueId),
    enabled: count > 0,
  });
  if (count === 0) return null;

  const files = (attachments.data ?? []).filter(
    (a): a is IssueAttachment & { url: string } => !!a.url,
  );
  return (
    <>
      <SectionTitle title={`Attachments · ${count}`} />
      {attachments.isPending ? (
        <View style={styles.loading} accessibilityLabel="Loading attachments">
          {Array.from({ length: Math.min(count, 3) }, (_, i) => (
            <Skeleton key={i} width="100%" height={52} radius={10} />
          ))}
        </View>
      ) : attachments.error ? (
        <ErrorNote error={attachments.error} />
      ) : (
        <ListGroup>
          {files.map((a) => {
            const name = a.attributes?.name || "Attachment";
            const type = a.attributes?.type ?? "";
            const size = a.attributes?.size;
            return (
              <ListRow
                key={a.id}
                left={<AttachmentIcon attachment={a} />}
                title={name}
                subtitle={[formatBytes(size), type].filter(Boolean).join(" · ")}
                chevron
                onPress={() =>
                  router.push({
                    pathname: "/attachment",
                    params: { url: a.url, name, type, size: size ? String(size) : "" },
                  })
                }
              />
            );
          })}
        </ListGroup>
      )}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: { gap: theme.spacing.sm },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: 40, height: 40 },
}));
