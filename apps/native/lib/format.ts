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
export type RichBlock = { type: "text"; text: string } | { type: "image"; src: string };

/** Rich-text HTML → ordered text and image blocks, so inline images render in place. */
export function htmlToBlocks(html: string | null | undefined): RichBlock[] {
  if (!html) return [];
  const blocks: RichBlock[] = [];
  const imgTag = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let last = 0;
  for (const match of html.matchAll(imgTag)) {
    const text = htmlToText(html.slice(last, match.index));
    if (text) blocks.push({ type: "text", text });
    blocks.push({ type: "image", src: match[1].replace(/&amp;/g, "&") });
    last = match.index + match[0].length;
  }
  const tail = htmlToText(html.slice(last));
  if (tail) blocks.push({ type: "text", text: tail });
  return blocks;
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

const SHORT_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Local midnight for a YYYY-MM-DD (or longer ISO) string, without a UTC shift. */
export function parseDay(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Oct 18" (adds the year when it isn't this one). */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "";
  const date = parseDay(value);
  const base = `${SHORT_MONTH[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date().getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

/** "Friday, October 18" for the Today header. */
export function formatToday(now: Date): string {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/**
 * Relative target-date label, as the web Today rows: "3d late", "Today",
 * "Tomorrow", a weekday within the week, else "Oct 18".
 */
export function dueLabel(
  target: string | null | undefined,
  today: Date,
): { text: string; late: boolean } | null {
  if (!target) return null;
  const date = parseDay(target);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((date.getTime() - midnight.getTime()) / 86_400_000);
  if (diff < 0) return { text: `${-diff}d late`, late: true };
  if (diff === 0) return { text: "Today", late: false };
  if (diff === 1) return { text: "Tomorrow", late: false };
  return {
    text:
      diff < 7 ? SHORT_WEEKDAY[date.getDay()] : `${SHORT_MONTH[date.getMonth()]} ${date.getDate()}`,
    late: false,
  };
}

/** Seconds → "2h 5m" for the time-tracked total. */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
