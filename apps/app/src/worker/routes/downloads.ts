import { Hono } from "hono";
import type { Env } from "../lib/env";

// R2 key the release script (scripts/build-native-apk.sh --publish) uploads
// to. Re-uploading replaces it, so the download URL never changes.
const ANDROID_APK_KEY = "downloads/atur-latest.apk";

// Public: the APK is the same file for everyone and the app itself still
// requires sign-in.
export const downloadRoutes = new Hono<{ Bindings: Env }>({ strict: false }).get(
  "/android",
  async (c) => {
    const obj = await c.env.R2.get(ANDROID_APK_KEY);
    if (!obj) return c.json({ error: "The Android app isn't published yet." }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": String(obj.size),
        "Content-Disposition": 'attachment; filename="atur.apk"',
        "Cache-Control": "no-cache",
      },
    });
  },
);
