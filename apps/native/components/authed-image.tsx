import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { Image, Platform, type ImageProps } from "react-native";

import { assetSource } from "@/lib/api";

/** In-flight and finished downloads, so one asset shown twice downloads once. */
const downloads = new Map<string, Promise<string>>();

/**
 * Local file URI for an asset that needs the session token. React Native's
 * Image drops `source.headers` (Android's image pipeline fetched our assets
 * with no Authorization, so every one 401'd), so download it with the token
 * into the cache and show the file. Files are keyed by asset id; ids are
 * immutable, so a cached file never goes stale.
 */
function cachedAsset(uri: string, headers: Record<string, string>): Promise<string> {
  const key = /([^/?#]+)(?:\?[^#]*)?$/.exec(uri)?.[0] ?? uri;
  let pending = downloads.get(key);
  if (!pending) {
    const dir = new Directory(Paths.cache, "assets");
    const file = new File(dir, key.replace(/[^\w.-]/g, "_"));
    pending = (async () => {
      if (file.exists && file.size > 0) return file.uri;
      dir.create({ intermediates: true, idempotent: true });
      const done = await File.downloadFileAsync(uri, file, { headers, idempotent: true });
      return done.uri;
    })();
    // A failure must not stick: the next mount retries.
    pending.catch(() => downloads.delete(key));
    downloads.set(key, pending);
  }
  return pending;
}

type AuthedImageProps = Omit<ImageProps, "source"> & { src: string };

/** Image for an Atur asset URL (or any URL); authenticates our own assets. */
export function AuthedImage({ src, onError, ...rest }: AuthedImageProps) {
  const source = assetSource(src);
  // Web: the browser image request can't carry headers either, but the web
  // build shares the app origin's session cookie, so the plain URI works.
  const needsDownload = Platform.OS !== "web" && source.headers !== undefined;
  const [local, setLocal] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!needsDownload || !source.headers) return;
    let live = true;
    setLocal(null);
    setFailed(false);
    cachedAsset(source.uri, source.headers).then(
      (uri) => live && setLocal(uri),
      () => {
        if (!live) return;
        setFailed(true);
        onError?.({ nativeEvent: { error: "download failed" } } as never);
      },
    );
    return () => {
      live = false;
    };
    // source is rebuilt each render; the URI (and the token in it) is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.uri, needsDownload]);

  if (needsDownload && (failed || !local)) {
    // Placeholder keeps the layout (callers size the image) while it loads.
    return <Image {...rest} source={{ uri: undefined }} />;
  }
  return <Image {...rest} source={needsDownload ? { uri: local! } : source} onError={onError} />;
}
