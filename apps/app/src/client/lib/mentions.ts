// Entity mentions in quick notes. Tokens are typed after `@` and classified by
// case, mirroring how Atur keys entities:
//   @diatur   → workspace  (slug: lowercase + digits + dashes)
//   @DEV      → project    (identifier: UPPERCASE, per-workspace unique)
//   @DEV-29   → issue      (IDENTIFIER-sequence)
// A token must start a word (preceded by whitespace or string start) so
// emails like alice@x.com never match.

export type MentionKind = "workspace" | "project" | "issue";

export interface MentionCandidate {
  kind: MentionKind;
  /** Text typed after @, e.g. "diatur", "DEV", "DEV-29". */
  token: string;
  /** Primary display label (entity name). */
  label: string;
  /** Disambiguating context, e.g. the owning workspace name. */
  sublabel?: string;
  /** Workspace slug — first segment of every link target. */
  slug?: string;
  projectId?: string;
  seqId?: number;
}

export interface ParsedToken {
  token: string;
  /** Null when the token matches no entity shape — render as plain text. */
  kind: MentionKind | null;
  /** Position of the "@" itself — plain text before a chip stops here. */
  at: number;
  start: number;
  end: number;
}

const TOKEN_CHARS = "[A-Za-z][A-Za-z0-9_-]*";

/** Matches the trailing "@token" before the caret while typing. */
export function activeMentionQuery(
  textBeforeCaret: string,
): { query: string; start: number } | null {
  const m = new RegExp(`(?:^|\\s)@(${TOKEN_CHARS})$`).exec(textBeforeCaret);
  const query = m?.[1];
  if (!m || !query) return null;
  return { query, start: m.index + m[0].length - query.length };
}

/** Classifies a bare token (no @). Null → not an entity reference. */
export function classifyToken(token: string): MentionKind | null {
  if (/^[A-Z0-9]+-\d+$/.test(token)) return "issue";
  if (/^[A-Z0-9]{2,}$/.test(token)) return "project";
  if (/^[a-z0-9][a-z0-9_-]*$/.test(token)) return "workspace";
  return null;
}

/** All @tokens in note text with their positions, for rendering. */
export function parseNoteTokens(content: string): ParsedToken[] {
  const out: ParsedToken[] = [];
  const re = new RegExp(`(^|\\s)@(${TOKEN_CHARS})`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const [, boundary, token] = m;
    // boundary is "" for start-of-string matches — only undefined is invalid.
    if (boundary === undefined || !token) continue;
    const start = m.index + boundary.length + 1; // after "@" (keep the boundary char intact)
    out.push({
      token,
      kind: classifyToken(token),
      at: start - 1,
      start,
      end: start + token.length,
    });
  }
  return out;
}

export function mentionHref(
  kind: MentionKind,
  candidate: Pick<MentionCandidate, "slug" | "projectId" | "seqId">,
): string | null {
  if (!candidate.slug) return null;
  if (kind === "workspace") return `/${candidate.slug}`;
  if (kind === "project" && candidate.projectId) {
    return `/${candidate.slug}/projects/${candidate.projectId}`;
  }
  if (kind === "issue" && candidate.projectId && candidate.seqId != null) {
    return `/${candidate.slug}/projects/${candidate.projectId}/issues/${candidate.seqId}`;
  }
  return null;
}

/**
 * Resolve a parsed token against the loaded candidate pool. Project
 * identifiers and issue keys are only unique per workspace, so a mention in
 * notes must disambiguate: the workspace the user is currently browsing wins,
 * then the first match (candidates are recency-ordered).
 */
export function resolveToken(
  token: string,
  candidates: MentionCandidate[],
  currentSlug?: string,
): MentionCandidate | null {
  const matches = candidates.filter((c) => c.token.toLowerCase() === token.toLowerCase());
  if (matches.length === 0) return null;
  if (currentSlug) {
    const inWorkspace = matches.find((m) => m.slug === currentSlug);
    if (inWorkspace) return inWorkspace;
  }
  return matches[0] ?? null;
}

export function filterCandidates(
  query: string,
  candidates: MentionCandidate[],
  limit = 8,
): MentionCandidate[] {
  const q = query.toLowerCase();
  const starts: MentionCandidate[] = [];
  const contains: MentionCandidate[] = [];
  for (const c of candidates) {
    const token = c.token.toLowerCase();
    const label = c.label.toLowerCase();
    if (token.startsWith(q)) starts.push(c);
    else if (token.includes(q) || label.includes(q)) contains.push(c);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Build the mention pool from the user's workspaces, projects, and recent issues. */
export function buildCandidates(
  workspaces: { slug: string; name: string }[],
  projects: {
    id: string;
    name: string;
    identifier?: string | null;
    emoji?: string | null;
    workspace_slug: string;
    workspace_name: string;
  }[],
  issues: {
    name: string;
    sequence_id: number;
    project_id: string;
    project_identifier?: string | null;
    workspace_slug: string;
    workspace_name: string;
  }[],
): MentionCandidate[] {
  return [
    ...workspaces.map((w) => ({
      kind: "workspace" as const,
      token: w.slug,
      label: w.name,
      slug: w.slug,
    })),
    ...projects
      .filter((p) => p.identifier)
      .map((p) => ({
        kind: "project" as const,
        token: p.identifier!,
        label: `${p.emoji ?? ""}${p.name}`,
        sublabel: p.workspace_name,
        slug: p.workspace_slug,
        projectId: p.id,
      })),
    ...issues
      .filter((i) => i.project_identifier)
      .map((i) => ({
        kind: "issue" as const,
        token: `${i.project_identifier}-${i.sequence_id}`,
        label: i.name,
        sublabel: `${i.project_identifier}-${i.sequence_id} · ${i.workspace_name}`,
        slug: i.workspace_slug,
        projectId: i.project_id,
        seqId: i.sequence_id,
      })),
  ];
}
