import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import CommentContent from "@/components/editor/CommentContent";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  codeLanguage,
  fileKind,
  formatBytes,
  TEXT_PREVIEW_MAX_BYTES,
  type FileKind,
} from "@/lib/fileKind";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileAudio,
  FileCode,
  FileIcon,
  FileImage,
  FilePdf,
  FileText,
  FileVideo,
  Loader2,
} from "@/lib/icons";
import { apiOrigin, authHeaders, resolveApiUrl } from "@/lib/native";

export interface ViewerFile {
  /** API path (`/api/assets/<id>`) or absolute URL. */
  url: string;
  name: string;
  type?: string | null;
  size?: number | null;
}

const KIND_ICON: Record<FileKind, typeof FileIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FilePdf,
  markdown: FileText,
  text: FileCode,
  other: FileIcon,
};

export function FileKindIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon className={className} />;
}

// Highlighting a huge file blocks the main thread; past this it stays plain.
const HIGHLIGHT_MAX_CHARS = 200_000;

/**
 * Full-screen viewer for uploaded files: images, video and audio (the asset
 * route serves byte ranges, so seeking works), PDFs in the browser's own
 * viewer, Markdown rendered like issue descriptions and text/code with syntax
 * highlighting. Anything else offers a download. `index` null = closed;
 * ←/→ step through `files`.
 */
export function FileViewer({
  files,
  index,
  onIndexChange,
}: {
  files: ViewerFile[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const file = index === null ? undefined : files[index];
  const count = files.length;

  useEffect(() => {
    if (index === null || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      // Media elements and inputs use the arrows themselves (seek, caret).
      const target = e.target as HTMLElement | null;
      if (target?.closest("video, audio, input, textarea, [contenteditable='true']")) return;
      if (e.key === "ArrowLeft") onIndexChange((index - 1 + count) % count);
      else if (e.key === "ArrowRight") onIndexChange((index + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onIndexChange]);

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onIndexChange(null)}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        {file && index !== null && (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b py-2 pl-4 pr-12">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm font-medium">{file.name}</DialogTitle>
                <DialogDescription className="font-ops-mono truncate text-xs text-muted-foreground">
                  {[formatBytes(file.size), file.type, count > 1 ? `${index + 1} / ${count}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </DialogDescription>
              </div>
              {count > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Previous file"
                    onClick={() => onIndexChange((index - 1 + count) % count)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Next file"
                    onClick={() => onIndexChange((index + 1) % count)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </>
              )}
              <a
                href={resolveApiUrl(file.url)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in new tab"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
              >
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
              <a
                href={resolveApiUrl(file.url)}
                download={file.name}
                aria-label="Download"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
              </a>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-muted/30">
              <FileBody key={file.url} file={file} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileBody({ file }: { file: ViewerFile }) {
  const kind = fileKind(file.type, file.name);
  const src = resolveApiUrl(file.url);
  switch (kind) {
    case "image":
      return (
        <div className="flex h-full items-center justify-center p-4">
          <img src={src} alt={file.name} className="max-h-full max-w-full object-contain" />
        </div>
      );
    case "video":
      return (
        <div className="flex h-full items-center justify-center bg-black">
          <video src={src} controls autoPlay playsInline className="max-h-full max-w-full" />
        </div>
      );
    case "audio":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
          <FileAudio className="h-16 w-16 text-muted-foreground" />
          <audio src={src} controls autoPlay className="w-full max-w-xl" />
        </div>
      );
    case "pdf":
      return <iframe src={src} title={file.name} className="h-full w-full border-0 bg-white" />;
    case "markdown":
    case "text":
      return <TextBody file={file} src={src} markdown={kind === "markdown"} />;
    default:
      return <NoPreview file={file} src={src} message="No preview for this file type." />;
  }
}

function TextBody({ file, src, markdown }: { file: ViewerFile; src: string; markdown: boolean }) {
  const tooBig = (file.size ?? 0) > TEXT_PREVIEW_MAX_BYTES;
  const { data, isLoading, error } = useQuery({
    queryKey: ["file-text", src],
    queryFn: async () => {
      // `url` may point anywhere (attachments can be links); only our own API
      // gets the session token.
      const own =
        new URL(src, window.location.href).origin === (apiOrigin || window.location.origin);
      const res = await fetch(src, own ? { credentials: "include", headers: authHeaders() } : {});
      if (!res.ok) throw new Error(`Couldn't load the file (${res.status})`);
      return res.text();
    },
    enabled: !tooBig,
    staleTime: Infinity,
  });
  const html = useMemo(() => {
    if (data === undefined) return "";
    if (markdown) return marked.parse(data, { async: false, gfm: true });
    const lang = data.length > HIGHLIGHT_MAX_CHARS ? "plaintext" : codeLanguage(file.name);
    const escaped = data.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<pre><code class="language-${lang}">${escaped}</code></pre>`;
  }, [data, markdown, file.name]);

  if (tooBig) return <NoPreview file={file} src={src} message="Too large to preview." />;
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) return <NoPreview file={file} src={src} message={(error as Error).message} />;
  return (
    <div
      className={
        markdown
          ? "mx-auto max-w-3xl bg-background px-8 py-6 prose prose-sm"
          : "bg-background p-4 [&_pre]:m-0"
      }
    >
      <CommentContent html={html} />
    </div>
  );
}

function NoPreview({ file, src, message }: { file: ViewerFile; src: string; message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <FileKindIcon
        kind={fileKind(file.type, file.name)}
        className="h-12 w-12 text-muted-foreground"
      />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild size="sm">
        <a href={src} download={file.name}>
          <Download className="h-3.5 w-3.5" /> Download
        </a>
      </Button>
    </div>
  );
}
