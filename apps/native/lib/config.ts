// Expo inlines EXPO_PUBLIC_* at bundle time. Unset → production Atur.
export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || "https://app.diatur.com").replace(
  /\/+$/,
  "",
);
