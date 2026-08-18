import { useLayoutEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { enhanceCodeBlocks } from "@/lib/codeBlocks";

interface CommentContentProps {
  html: string;
}

export default function CommentContent({ html }: CommentContentProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    enhanceCodeBlocks(ref.current, { highlight: true });
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
    <div
      ref={ref}
      className="md-viewer max-w-none text-sm"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
