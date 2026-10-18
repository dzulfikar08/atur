// Expo inlines EXPO_PUBLIC_* at bundle time. Unset → production Atur.
export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || "https://app.diatur.com").replace(
  /\/+$/,
  "",
);

// Public `pk_fb_…` token of Atur's own feedback board (workspace diatur, project
// DEV); the in-app report sheet files into it. Public by design, like the web
// widget's data-token. Override with EXPO_PUBLIC_FEEDBACK_TOKEN.
export const FEEDBACK_TOKEN =
  process.env.EXPO_PUBLIC_FEEDBACK_TOKEN || "pk_fb_333e4c54c86d45aa9f30ccc36fe2b561";
