import { defineConfig } from "tsdown";

// zod installs its English error messages by calling `config(en())` when `zod` is imported, yet its
// package.json declares `sideEffects: false`; bundled without this rule, every message reads
// "Invalid input".
const ZOD_LOCALE_SETUP = /[\\/]zod[\\/]v4[\\/]classic[\\/]external\.js$/;

export default defineConfig({
  entry: ["src/cli.ts"],
  noExternal: [/./],
  treeshake: {
    moduleSideEffects: [{ test: ZOD_LOCALE_SETUP, sideEffects: true }],
  },
  format: "esm",
  clean: true,
  shims: true,
  target: "node20.6",
  outputOptions: {
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name]-[hash].mjs",
  },
});
