import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// The packaged app ships `out/` alone, so every dependency is bundled into it; a
// sandboxed preload could not `require` from node_modules anyway.
const BUNDLE_DEPENDENCIES = { externalizeDeps: false };

export default defineConfig({
  main: {
    build: {
      ...BUNDLE_DEPENDENCIES,
      // A native addon cannot be bundled; electron-builder ships it unpacked beside `out/`.
      rollupOptions: { external: ["node-pty"] },
    },
  },
  preload: {
    build: {
      ...BUNDLE_DEPENDENCIES,
      // Electron runs a sandboxed preload as a plain script, so it cannot be an ES module.
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve: {
      alias: { "@": resolve(import.meta.dirname, "src/renderer") },
    },
    plugins: [react(), tailwindcss()],
    // The diff viewer's highlighting worker loads grammars with a dynamic import, which only an ES
    // module worker can split into chunks.
    worker: { format: "es" },
  },
});
