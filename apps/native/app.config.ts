import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExpoConfig } from "expo/config";

// Expo hands this function app.json as `config`. FCM needs google-services.json (Firebase, gitignored); builds
// without it still work, they just cannot receive Android pushes.
export default ({ config }: { config: ExpoConfig }): ExpoConfig => {
  const googleServicesFile = "./google-services.json";
  if (!existsSync(join(__dirname, googleServicesFile))) return config;
  return { ...config, android: { ...config.android, googleServicesFile } };
};
