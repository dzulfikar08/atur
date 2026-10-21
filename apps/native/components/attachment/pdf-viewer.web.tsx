import { useEffect, useState } from "react";

import { FileCard } from "@/components/attachment/file-card";
import type { AttachmentActions } from "@/components/attachment/use-attachment-actions";
import { assetSource } from "@/lib/api";
import type { AttachmentRef } from "@/lib/attachment-file";

// Dev-only stand-in so `expo start --web` renders PDFs: an iframe can't send the
// bearer header, so fetch the file and frame a blob URL. Not shipped (the store
// apps use pdf-viewer.tsx).
export function PdfViewer({ att, actions }: { att: AttachmentRef; actions: AttachmentActions }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    const { uri, headers } = assetSource(att.url);
    fetch(uri, { headers })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setBlobUrl(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [att.url]);

  if (failed) return <FileCard att={att} actions={actions} message="Couldn't load the PDF." />;
  if (!blobUrl) return null;
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      <iframe
        src={blobUrl}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        title={att.name}
      />
    </div>
  );
}
