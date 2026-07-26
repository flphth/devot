import { createReadStream, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const MEDIA_DIR = resolve(import.meta.dirname, "../../docs/media");
const MEDIA = ["world.jpg", "creation.jpg", "birth.jpg"];

/**
 * The landing page shows the same three screenshots as the README, and there is
 * only ever going to be one truth about what the game looks like — so they are
 * served out of docs/media rather than copied into public/, where the two would
 * drift the first time a screen is retaken. Dev serves them off disk, build
 * emits them next to the page.
 */
function sharedMedia(): Plugin {
  return {
    name: "devot:shared-media",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        const name = path.startsWith("/media/") ? path.slice("/media/".length) : null;
        if (name === null || !MEDIA.includes(name)) return next();
        res.setHeader("Content-Type", "image/jpeg");
        createReadStream(join(MEDIA_DIR, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of MEDIA) {
        this.emitFile({
          type: "asset",
          fileName: `media/${name}`,
          source: readFileSync(join(MEDIA_DIR, name)),
        });
      }
    },
  };
}

/**
 * Two pages out of one build:
 *   /       the landing page — static HTML, no React, no bundle
 *   /game/  the world itself
 */
export default defineConfig({
  plugins: [react(), sharedMedia()],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        game: resolve(import.meta.dirname, "game/index.html"),
      },
    },
  },
});
