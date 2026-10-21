import { FileCard } from "@/components/attachment/file-card";
import { ImageViewer } from "@/components/attachment/image-viewer";
import { MediaViewer } from "@/components/attachment/media-viewer";
import { PdfViewer } from "@/components/attachment/pdf-viewer";
import { TextPreview } from "@/components/attachment/text-preview";
import { TextViewer } from "@/components/attachment/text-viewer";
import type { AttachmentActions } from "@/components/attachment/use-attachment-actions";
import { MarkdownView } from "@/components/markdown-view";
import type { AttachmentRef } from "@/lib/attachment-file";
import { fileKind } from "@/lib/file-kind";

/** The in-app viewer for one attachment, chosen by `fileKind` (same table as the web). */
export function AttachmentViewer({
  att,
  actions,
}: {
  att: AttachmentRef;
  actions: AttachmentActions;
}) {
  switch (fileKind(att.type, att.name)) {
    case "image":
      return <ImageViewer att={att} />;
    case "video":
      return <MediaViewer att={att} audio={false} />;
    case "audio":
      return <MediaViewer att={att} audio />;
    case "pdf":
      return <PdfViewer att={att} actions={actions} />;
    case "markdown":
      return (
        <TextPreview att={att} actions={actions}>
          {(text) => <MarkdownView source={text} />}
        </TextPreview>
      );
    case "text":
      return (
        <TextPreview att={att} actions={actions}>
          {(text) => <TextViewer text={text} />}
        </TextPreview>
      );
    case "other":
      return <FileCard att={att} actions={actions} />;
  }
}
