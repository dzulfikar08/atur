import Constants from "expo-constants";
import { Dimensions, Platform } from "react-native";
import { captureScreen } from "react-native-view-shot";

import { ApiError } from "@/lib/api";
import { FEEDBACK_TOKEN, SERVER_URL } from "@/lib/config";
import {
  getCurrentRoute,
  getFailedRequests,
  getRecentErrors,
  type CapturedError,
  type FailedRequest,
} from "@/lib/diagnostics";

// Client for the public feedback API (routes/feedback.ts):
//   POST /api/feedback/:token/attachments  multipart `file`
//   POST /api/feedback/:token/items        JSON
// Both are unauthenticated; the board token is the only credential.

export type ReportKind = "idea" | "bug" | "question";

export const REPORT_KINDS: { value: ReportKind; label: string; hint: string }[] = [
  { value: "idea", label: "Idea", hint: "Suggest an improvement" },
  { value: "bug", label: "Bug", hint: "Something is broken" },
  { value: "question", label: "Question", hint: "Ask for help" },
];

export type ReportContext = {
  viewport: string;
  platform: string;
  os: string;
  app_version?: string;
  url?: string;
  console_errors?: CapturedError[];
  failed_requests?: FailedRequest[];
};

export type ReportUser = { id: string; email?: string | null; name?: string | null };

export type Screenshot = { uri: string; name: string; type: string };

export type ReportResult = { id: string; sequence_id: number; url: string };

type Attachment = { id: string; url: string; filename: string; size: number; mime: string };

const base = () => `${SERVER_URL}/api/feedback/${FEEDBACK_TOKEN}`;

/** Everything the server can use to reproduce the report without asking. */
export function collectContext(): ReportContext {
  const { width, height } = Dimensions.get("window");
  const route = getCurrentRoute();
  return {
    viewport: `${Math.round(width)}x${Math.round(height)}`,
    platform: Platform.OS,
    os: Platform.OS === "web" ? "web" : `${Platform.OS} ${Platform.Version}`,
    app_version: Constants.expoConfig?.version,
    url: route ? `atur://${route.replace(/^\//, "")}` : undefined,
    console_errors: getRecentErrors(),
    failed_requests: getFailedRequests(),
  };
}

/**
 * Snapshot of the screen that is showing right now. Call it BEFORE the report
 * sheet opens, or the sheet ends up in the picture. Resolves null when capture
 * isn't available (native module missing from this build); the report is still
 * useful without a picture.
 */
export async function captureCurrentScreen(): Promise<Screenshot | null> {
  try {
    const web = Platform.OS === "web";
    const uri = await captureScreen({
      format: "jpg",
      quality: 0.8,
      result: web ? "data-uri" : "tmpfile",
    });
    return { uri, name: "screenshot.jpg", type: "image/jpeg" };
  } catch {
    return null;
  }
}

async function failure(res: Response): Promise<ApiError> {
  const text = await res.text();
  let message = `Request failed (${res.status})`;
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string") message = body.error;
    else if (typeof body.message === "string") message = body.message;
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return new ApiError(res.status, message);
}

async function send(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Can't reach Atur. Check your connection.");
  }
  if (!res.ok) throw await failure(res);
  return res;
}

async function uploadAttachment(file: Screenshot): Promise<Attachment> {
  const form = new FormData();
  if (Platform.OS === "web") {
    // Web FormData takes Blobs; the data-uri comes from the web capture.
    form.append("file", await (await fetch(file.uri)).blob(), file.name);
  } else {
    // React Native's FormData streams a file straight from its uri.
    form.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
  const res = await send(`${base()}/attachments`, { method: "POST", body: form });
  return (await res.json()) as Attachment;
}

export async function submitReport(
  input: {
    kind: ReportKind;
    title: string;
    description: string;
    screenshot: Screenshot | null;
    user: ReportUser | null;
  },
  onStep: (step: "uploading" | "sending") => void,
): Promise<ReportResult> {
  const attachmentIds: string[] = [];
  if (input.screenshot) {
    onStep("uploading");
    attachmentIds.push((await uploadAttachment(input.screenshot)).id);
  }
  onStep("sending");

  const description = input.description.trim();
  const res = await send(`${base()}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      title: input.title.trim(),
      description: description || undefined,
      kind: input.kind,
      source: "native",
      context: collectContext(),
      attachment_ids: attachmentIds.length ? attachmentIds : undefined,
      // No signature: the server marks it unverified, which is fine for
      // Atur's own board — the user is signed in to Atur itself.
      external_user: input.user
        ? {
            id: input.user.id,
            email: input.user.email ?? undefined,
            name: input.user.name ?? undefined,
          }
        : undefined,
    }),
  });
  return (await res.json()) as ReportResult;
}

/** Absolute link to the filed item (the server may return a path). */
export const reportUrl = (url: string) => (url.startsWith("/") ? `${SERVER_URL}${url}` : url);
