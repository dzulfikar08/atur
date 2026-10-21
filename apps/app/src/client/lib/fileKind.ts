// Which viewer an attachment opens in. Mirrored in apps/native/lib/file-kind.ts;
// keep the two in step.

export type FileKind = "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "other";

/** Text previews stop here: bigger files download instead of freezing the tab. */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

// Extension wins over MIME: browsers report `.md` as "" or text/plain and
// `.ts` as video/mp2t, while uploads with a real media type keep it.
const EXT_KIND: Record<string, FileKind> = {};
const add = (kind: FileKind, exts: string) => {
  for (const e of exts.split(" ")) EXT_KIND[e] = kind;
};
add("image", "png jpg jpeg gif webp avif bmp ico svg heic heif");
add("video", "mp4 m4v mov webm ogv");
add("audio", "mp3 m4a aac wav oga ogg opus flac");
add("pdf", "pdf");
add("markdown", "md markdown mdown mkd");
add(
  "text",
  "txt log csv tsv json jsonl ndjson yaml yml toml ini cfg conf env xml html htm css scss " +
    "js mjs cjs jsx ts tsx py rb go rs java kt swift c h cc cpp hpp cs php lua sh bash zsh " +
    "sql graphql diff patch",
);

export function fileExtension(name: string | null | undefined): string {
  return /\.([a-z0-9]+)$/i.exec(name ?? "")?.[1]?.toLowerCase() ?? "";
}

export function fileKind(
  type: string | null | undefined,
  name: string | null | undefined,
): FileKind {
  const byExt = EXT_KIND[fileExtension(name)];
  if (byExt) return byExt;
  const mime = (type ?? "").replace(/;.*$/, "").trim().toLowerCase();
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.startsWith("text/") ||
    /^application\/(json|xml|yaml|x-yaml|toml|javascript|x-sh|sql)$/.test(mime)
  )
    return "text";
  return "other";
}

// highlight.js language per extension; anything unlisted renders as plain text
// (no auto-detection guessing a CSV is Perl).
const HLJS_LANG: Record<string, string> = {
  json: "json",
  jsonl: "json",
  ndjson: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  xml: "xml",
  html: "xml",
  htm: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  graphql: "graphql",
  diff: "diff",
  patch: "diff",
};

export function codeLanguage(name: string | null | undefined): string {
  return HLJS_LANG[fileExtension(name)] ?? "plaintext";
}

export function formatBytes(size: number | null | undefined): string {
  if (!size) return "";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
