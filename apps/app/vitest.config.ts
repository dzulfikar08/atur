import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // jsdom 29 leaves the window at an opaque origin when no URL is set, where
    // `localStorage`/`document.cookie` throw SecurityError. Pin an origin.
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    globals: true,
    setupFiles: ["./src/client/test/setup.ts"],
    // React 19.2.x only exports `act` from its development build. Tests need
    // it (react-dom's deprecated test-utils calls React.act), so force the
    // development build under vitest.
    env: { NODE_ENV: "development" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/client"),
      // Stub for Cloudflare's email module — lets service tests import
      // worker/services/email.ts outside the Workers runtime.
      "cloudflare:email": path.resolve(__dirname, "./src/client/test/stubs/cloudflare-email.ts"),
    },
  },
});
