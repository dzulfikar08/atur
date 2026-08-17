import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
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
    },
  },
});
