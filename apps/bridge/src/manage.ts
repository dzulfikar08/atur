/**
 * Pane management routes: list workspaces, create a workspace, split and close
 * a pane. Pure `Request -> Response` over a PaneBackend so they run under
 * `bun test` without a socket (server.ts only dispatches here after the
 * x-bridge-token check).
 *
 *   GET  /workspaces      -> {workspaces:[{id,label,cwd,pane_count}]}
 *   POST /workspaces      {cwd,label?}                 -> 201 {workspace, pane}
 *   POST /panes/split     {pane,direction,cwd?}        -> 201 {pane}
 *   POST /panes/close     {pane}                       -> 204
 *
 * 400 invalid input, 404 unknown pane, 409 name taken, 502 backend failure.
 */
import { stat } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import {
  ConflictError,
  PaneGoneError,
  workspacesOf,
  type PaneBackend,
  type SplitDirection,
  type WorkspaceSummary,
} from "./backend";
import { listItem } from "./hub";

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

const MAX_BODY_BYTES = 8 * 1024;
const MAX_PATH_CHARS = 4096;
const MAX_LABEL_CHARS = 64;
const MAX_PANE_ID_CHARS = 128;

/** C0 controls, DEL and C1 controls. */
function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** An absolute path (normalised, no trailing slash) to a directory that exists now. */
export async function validateCwd(value: unknown): Promise<string> {
  if (typeof value !== "string" || value === "") throw new InputError("cwd is required");
  if (value.length > MAX_PATH_CHARS) throw new InputError("cwd is too long");
  if (hasControlChars(value)) throw new InputError("cwd has control characters");
  if (!isAbsolute(value)) throw new InputError("cwd must be an absolute path");
  const path = normalize(value).replace(/(?<=.)\/+$/, "");
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) throw new InputError("cwd is not an existing directory");
  return path;
}

/** Trimmed label, or undefined when none was given. */
export function validateLabel(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new InputError("label must be a string");
  const label = value.trim();
  if (label === "") return undefined;
  if (label.length > MAX_LABEL_CHARS) {
    throw new InputError(`label is longer than ${MAX_LABEL_CHARS} characters`);
  }
  if (hasControlChars(label)) throw new InputError("label has control characters");
  return label;
}

function validatePaneId(value: unknown): string {
  if (typeof value !== "string" || value === "") throw new InputError("pane is required");
  if (value.length > MAX_PANE_ID_CHARS || hasControlChars(value)) {
    throw new InputError("pane is not a valid pane id");
  }
  return value;
}

function validateDirection(value: unknown): SplitDirection {
  if (value === "right" || value === "down") return value;
  throw new InputError("direction must be right or down");
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new InputError("body too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new InputError("body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new InputError("body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function workspaceItem(w: WorkspaceSummary) {
  return { id: w.id, label: w.label, cwd: w.cwd, pane_count: w.paneCount };
}

function errorResponse(e: unknown): Response {
  if (e instanceof InputError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof PaneGoneError)
    return Response.json({ error: "pane not found" }, { status: 404 });
  if (e instanceof ConflictError) return Response.json({ error: e.message }, { status: 409 });
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
}

/** The matching management route's response, or null when the request is not one of them. */
export async function handleManage(
  req: Request,
  url: URL,
  backend: PaneBackend,
): Promise<Response | null> {
  const { pathname } = url;
  const post = req.method === "POST";
  try {
    if (pathname === "/workspaces" && req.method === "GET") {
      const panes = await backend.listPanes();
      return Response.json({ workspaces: workspacesOf(panes).map(workspaceItem) });
    }
    if (pathname === "/workspaces" && post) {
      const body = await readJson(req);
      const cwd = await validateCwd(body.cwd);
      const label = validateLabel(body.label);
      const created = await backend.createWorkspace({ cwd, label });
      console.log(`workspace created: ${created.workspace.id} "${created.workspace.label}" ${cwd}`);
      return Response.json(
        { workspace: workspaceItem(created.workspace), pane: listItem(created.pane) },
        { status: 201 },
      );
    }
    if (pathname === "/panes/split" && post) {
      const body = await readJson(req);
      const pane = validatePaneId(body.pane);
      const direction = validateDirection(body.direction);
      const cwd = body.cwd === undefined ? undefined : await validateCwd(body.cwd);
      const created = await backend.splitPane(pane, direction, cwd);
      console.log(`pane split: ${pane} ${direction} -> ${created.id}`);
      return Response.json({ pane: listItem(created) }, { status: 201 });
    }
    if (pathname === "/panes/close" && post) {
      const pane = validatePaneId((await readJson(req)).pane);
      await backend.closePane(pane);
      console.log(`pane closed: ${pane}`);
      return new Response(null, { status: 204 });
    }
  } catch (e) {
    return errorResponse(e);
  }
  return null;
}
