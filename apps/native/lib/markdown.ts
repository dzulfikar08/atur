// Pure helpers for the native markdown viewer (components/markdown-view.tsx),
// kept free of React Native so bun can test them. Tokens come from
// `marked.lexer()`; nothing here ever produces HTML.

import type { Token, Tokens } from "marked";

/** A link is only followed when it is http(s); javascript:, file:, intent: and friends are dead text. */
export function linkTarget(href: string | null | undefined): string | null {
  const value = (href ?? "").trim();
  return /^https?:\/\//i.test(value) ? value : null;
}

/**
 * Where an inline image loads from: an absolute http(s) URL or a server path
 * (`/api/assets/<id>`, how the web editor stores uploads). Relative file
 * references like `./diagram.png` have nothing to resolve against, so they
 * render as their alt text instead.
 */
export function imageTarget(href: string | null | undefined): string | null {
  const value = (href ?? "").trim();
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") && !value.startsWith("//") ? value : null;
}

export type InlineSegment =
  | { kind: "inline"; tokens: Token[] }
  | { kind: "image"; token: Tokens.Image };

/**
 * Split a run of inline tokens at its images: text can't host a View, so each
 * image becomes its own block between the text runs around it.
 */
export function splitInlineImages(tokens: Token[]): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let run: Token[] = [];
  for (const token of tokens) {
    if (token.type === "image") {
      if (run.length > 0) segments.push({ kind: "inline", tokens: run });
      run = [];
      segments.push({ kind: "image", token: token as Tokens.Image });
    } else {
      run.push(token);
    }
  }
  if (run.length > 0) segments.push({ kind: "inline", tokens: run });
  return segments;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * The lexer keeps character references in text tokens verbatim (`&amp;`), and
 * native text has no HTML pass to resolve them. Unknown references stay as written.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref.startsWith("#")) {
      const hex = ref[1] === "x" || ref[1] === "X";
      const code = hex ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}
