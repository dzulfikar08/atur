import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json stays the single source of truth. This wrapper only exposes the
 * distribution channel, read from ATUR_DISTRIBUTION at prebuild/bundle time, as
 * extra.distribution (lib/distribution.ts -> IS_PLAY_BUILD):
 *
 * - unset / "site": the sideload APK served from app.diatur.com. Profile shows
 *   the "Download latest Android app" row.
 * - "play": Google Play build. Play forbids apps that distribute their own
 *   updates, so that row is hidden. The manifest is identical: the app never
 *   installs packages itself, the browser handles the download.
 */
const DISTRIBUTIONS = ["site", "play"] as const;

function distributionFromEnv(): (typeof DISTRIBUTIONS)[number] {
  const value = process.env.ATUR_DISTRIBUTION ?? "site";
  const known = DISTRIBUTIONS.find((d) => d === value);
  if (!known) {
    throw new Error(
      `ATUR_DISTRIBUTION must be one of ${DISTRIBUTIONS.join(", ")} (got "${value}")`,
    );
  }
  return known;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Atur",
  slug: config.slug ?? "atur",
  extra: { ...config.extra, distribution: distributionFromEnv() },
});
