import { charWidth } from "@/lib/ansi";

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
// Punctuation that ends a sentence rather than a URL ("see https://x.test/a.").
const SENTENCE_END = ".,;:!?]}>";

/** A URL found in a row's plain text, as a UTF-16 range `[start, end)`. */
export interface LinkRange {
  start: number;
  end: number;
  url: string;
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** Strip trailing sentence punctuation, and a ")" only when it has no "(" to close. */
function trimUrl(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1]!;
    if (SENTENCE_END.includes(last) || (last === ")" && count(url, ")") > count(url, "("))) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return url;
}

export function findLinks(text: string): LinkRange[] {
  const links: LinkRange[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (url.length <= "https://".length) continue;
    links.push({ start: match.index, end: match.index + url.length, url });
  }
  return links;
}

/** The URL under terminal column `cell` (0-based) of a row's plain text, if any. */
export function linkAtCell(text: string, cell: number): string | null {
  if (cell < 0) return null;
  const links = findLinks(text);
  if (links.length === 0) return null;
  // Map the touched column to a UTF-16 index; wide chars span two columns.
  let column = 0;
  let index = 0;
  for (const ch of text) {
    const width = Math.max(charWidth(ch.codePointAt(0) ?? 0), 0);
    if (cell < column + width) break;
    column += width;
    index += ch.length;
  }
  return links.find((l) => index >= l.start && index < l.end)?.url ?? null;
}
