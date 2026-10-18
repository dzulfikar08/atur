import { useEffect, useLayoutEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { enhanceCodeBlocks } from "@/lib/codeBlocks";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface CommentContentProps {
  html: string;
}

export default function CommentContent({ html }: CommentContentProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useLayoutEffect(() => {
    enhanceCodeBlocks(ref.current, { highlight: true });
  }, [html]);

  // Click any embedded image to view it full-screen. Issue descriptions,
  // comments and portal tickets all render through this component, so one
  // delegated listener covers every surface. Images wrapped in a link keep
  // their link behaviour instead of opening the lightbox.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest("img");
      if (!img?.src || img.closest("a")) return;
      e.preventDefault();
      setLightboxSrc(img.src);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [html]);

  if (!html) return null;

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "br",
      "hr",
      "strong",
      "em",
      "s",
      "del",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "input", // for task list checkboxes
      "span",
      "div",
      "sup",
      "sub",
      "details", // collapsible report-context block (feedback widget / native)
      "summary",
    ],
    ALLOWED_ATTR: [
      "href",
      "target",
      "rel",
      "src",
      "alt",
      "width",
      "height",
      "class",
      "type",
      "checked",
      "data-type",
      "data-checked",
      "data-mention-id",
      "data-mention-username",
      "colspan",
      "rowspan",
    ],
    ADD_TAGS: ["img"],
  });

  return (
    <>
      <div
        ref={ref}
        className="md-viewer max-w-none text-sm"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      {/* Radix supplies Esc, focus trap, aria-modal and the scroll lock —
          don't hand-roll them (three copies of that effect already drifted). */}
      <Dialog
        open={!!lightboxSrc}
        onOpenChange={(open) => {
          if (!open) setLightboxSrc(null);
        }}
      >
        <DialogContent className="max-w-none w-auto border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {lightboxSrc && (
            <img
              src={lightboxSrc}
              alt=""
              className="max-h-[85vh] max-w-[85vw] rounded-md object-contain shadow-2xl"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
