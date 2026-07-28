import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  noExternal: ["@metabase/client"],
  format: "esm",
  clean: true,
  shims: true,
  target: "node20.6",
  outputOptions: {
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name]-[hash].mjs",
  },
});
