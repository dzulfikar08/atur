import DOMPurify from 'dompurify';

interface CommentContentProps {
  html: string;
}

export default function CommentContent({ html }: CommentContentProps) {
  if (!html) return null;

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
      'strong', 'em', 's', 'del', 'u',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'input', // for task list checkboxes
      'span', 'div',
      'sup', 'sub',
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel',
      'src', 'alt', 'width', 'height',
      'class',
      'type', 'checked', 'data-type', 'data-checked',
      'colspan', 'rowspan',
    ],
    ADD_TAGS: ['img'],
  });

  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert text-sm
        prose-headings:mb-1 prose-headings:mt-2
        prose-p:my-1 prose-img:rounded-md prose-img:max-w-full
        prose-pre:bg-muted prose-pre:text-sm
        prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:rounded
        prose-a:text-primary prose-a:underline"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
