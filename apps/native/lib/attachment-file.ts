import { Directory, File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { assetSource } from "@/lib/api";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/file-kind";

/** What the viewer route receives (as string params) for one attachment. */
export interface AttachmentRef {
  url: string;
  name: string;
  type: string;
  /** Bytes, or null when the upload didn't record a size. */
  size: number | null;
}

// android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION (expo-intent-launcher ships no flag constants).
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const ACTION_VIEW = "android.intent.action.VIEW";

/** Raised when a text preview would exceed TEXT_PREVIEW_MAX_BYTES. */
export class TooLargeError extends Error {
  constructor() {
    super("This file is too large to preview.");
  }
}

/**
 * Download to the cache dir with the bearer token, keeping the original file
 * name (the share sheet and "open with" pickers key off its extension). One
 * folder per asset so two files named the same never collide.
 */
export async function downloadAttachment(att: AttachmentRef): Promise<File> {
  const { uri, headers } = assetSource(att.url);
  const assetId = /([^/?#]+)(?:[?#].*)?$/.exec(att.url)?.[1] ?? "file";
  const dir = new Directory(Paths.cache, "attachments", assetId.replace(/[^\w.-]/g, "_"));
  dir.create({ intermediates: true, idempotent: true });
  const name = att.name.replace(/[^\w.-]/g, "_") || "attachment";
  return File.downloadFileAsync(uri, new File(dir, name), { headers, idempotent: true });
}

/** Share sheet; on iOS it also offers "Open in…" for every installed app that can read the file. */
export async function shareAttachment(att: AttachmentRef): Promise<void> {
  const file = await downloadAttachment(att);
  await Sharing.shareAsync(file.uri, {
    mimeType: att.type || undefined,
    dialogTitle: att.name,
  });
}

/**
 * View in another app. Android: ACTION_VIEW on the FileProvider content URI
 * (the share sheet is for sending, not viewing). iOS has no direct equivalent,
 * so it falls back to the share sheet.
 */
export async function openAttachment(att: AttachmentRef): Promise<void> {
  if (Platform.OS !== "android") return shareAttachment(att);
  const file = await downloadAttachment(att);
  try {
    await IntentLauncher.startActivityAsync(ACTION_VIEW, {
      data: file.contentUri,
      type: att.type || undefined,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch {
    throw new Error("No app on this device can open this file. Try Share instead.");
  }
}

/** The file's text, refusing anything past the preview cap before reading the body. */
export async function fetchAttachmentText(att: AttachmentRef): Promise<string> {
  const { uri, headers } = assetSource(att.url);
  const res = await fetch(uri, { headers });
  if (!res.ok) throw new Error(`Couldn't load the file (${res.status}).`);
  const length = Number(res.headers.get("content-length"));
  if (length > TEXT_PREVIEW_MAX_BYTES) throw new TooLargeError();
  return res.text();
}
