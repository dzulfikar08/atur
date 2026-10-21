import type { IconName } from "@/components/ui";
import type { FileKind } from "@/lib/file-kind";

export const KIND_ICON: Record<FileKind, IconName> = {
  image: "image-outline",
  video: "videocam-outline",
  audio: "musical-notes-outline",
  pdf: "document-text-outline",
  markdown: "reader-outline",
  text: "code-slash-outline",
  other: "document-outline",
};
