import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";

// @tiptap/y-tiptap imports prosemirror-transform without declaring it (upstream bug) —
// resolve the workspace copy so rolldown finds it from the bun store realpath
const prosemirrorTransform = createRequire(import.meta.url).resolve("prosemirror-transform");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      disable: process.env.NODE_ENV === "development",
      includeAssets: ["favicon.ico", "favicon-32.png"],
      manifest: {
        name: "Atur",
        short_name: "Atur",
        description: "Organize everything",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,txt,woff2}"],
        runtimeCaching: [],
        // The default navigateFallback serves cached index.html for EVERY
        // navigation. The OAuth endpoints are worker routes (302 → accounts.
        // google.com, then back with the session cookie) — once the SW
        // swallowed them, the button hung at /auth/google and WebKit logged
        // "Unsafe attempt to load URL" for the cross-origin redirect.
        navigateFallbackDenylist: [/^\/auth\/google\/?$/, /^\/auth\/google\/callback\/?$/],
      },
    }),
    cloudflare(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
      // Force single React instance to avoid duplicate hooks crash
      react: fileURLToPath(new URL("./node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./node_modules/react-dom", import.meta.url)),
      // tiptap-markdown (bun store) can't resolve @tiptap/pm peers — pin to local copy
      "@tiptap/pm/model": fileURLToPath(
        new URL("./node_modules/@tiptap/pm/dist/model/index.js", import.meta.url),
      ),
      "@tiptap/pm/state": fileURLToPath(
        new URL("./node_modules/@tiptap/pm/dist/state/index.js", import.meta.url),
      ),
      "prosemirror-transform": prosemirrorTransform,
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
});
