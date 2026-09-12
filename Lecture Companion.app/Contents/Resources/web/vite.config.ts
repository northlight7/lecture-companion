import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * The backend serves `web/index.html` at `/` and mounts `web/` at `/static`
 * (app/main.py). `app/` is frozen, so the build has to land where that mount
 * already points rather than the other way round:
 *
 *   root      web/src        so the Vite entry `src/index.html` is never the
 *                            same file the build writes
 *   outDir    web/           the directory the /static mount already serves
 *   base      /static/       so every emitted asset URL resolves under it
 *
 * emptyOutDir is false on purpose: emptyOutDir is what would delete the old
 * frontend, and the old frontend is deleted only once its replacement passes.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./src", import.meta.url)),
  base: "/static/",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL(".", import.meta.url)),
    emptyOutDir: false,
    assetsDir: "assets",
    sourcemap: false,
    target: "safari17",
    // mermaid is the only thing here that exceeds this. It is a dynamic
    // import, so nothing of it is fetched until a slide actually has a
    // diagram, and the app is served from disk rather than over a network.
    // The warning is raised rather than hidden, and the number is stated.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Content-hashed. Stable names were tried, on the reasoning that the
        // bundle is served from disk by a local process and a hash buys
        // nothing. That was wrong: the web view keeps a real HTTP cache, so
        // after a rebuild it went on serving the previous app.js and every
        // screenshot showed the build before last. A content hash makes a
        // stale asset impossible.
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
