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
  // The command reference ships in the package. It is written after each bundle because `clean`
  // removes all of `dist/` first. The script runs as its own process so this config never loads
  // the command tree.
  onSuccess: "bun ../../scripts/generate-docs.ts",
});
