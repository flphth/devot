import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Two pages out of one build:
 *   /       the landing page — static HTML, no React, no bundle
 *   /game/  the world itself
 *
 * The landing page's screenshots live in docs/media (the README shows the same
 * three), so they are referenced across the workspace rather than duplicated;
 * Vite hashes and emits them like any other asset. fs.allow keeps the dev
 * server willing to serve them.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [resolve(import.meta.dirname, "../..")] },
  },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        game: resolve(import.meta.dirname, "game/index.html"),
      },
    },
  },
});
