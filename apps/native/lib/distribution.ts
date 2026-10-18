import Constants from "expo-constants";

/**
 * True in the Google Play build (ATUR_DISTRIBUTION=play, see app.config.ts).
 * Play forbids apps that install APKs themselves, so the Android updater row in
 * Profile is hidden there; Play delivers updates.
 */
export const IS_PLAY_BUILD = Constants.expoConfig?.extra?.distribution === "play";
