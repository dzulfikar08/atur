const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Rich-text HTML (tiptap) → readable plain text, keeping paragraph/list breaks. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return (
    html
      .replace(/<br\s*\/?>/gi, "\n")
      // tiptap wraps list item text in <p>; don't double-space the list.
      .replace(/<\/p>\s*<\/li>/gi, "</li>")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/(p|h[1-6]|pre|blockquote|ul|ol)>/gi, "\n\n")
      .replace(/<\/(div|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Plain text typed on the phone → the paragraph HTML the web editor stores. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p>${para
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

/** "just now", "5m", "3h", "2d", then a short date. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso.includes("T") || iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function displayName(user: {
  display_name?: string | null;
  username?: string | null;
  email?: string | null;
}): string {
  return user.display_name || user.username || user.email?.split("@")[0] || "Unknown";
}
