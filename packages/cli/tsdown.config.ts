import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "exports/auth": "src/exports/auth.ts",
    "exports/client": "src/exports/client.ts",
    "exports/domain": "src/exports/domain.ts",
    "exports/errors": "src/exports/errors.ts",
    "exports/config": "src/exports/config.ts",
    "exports/paginate": "src/exports/paginate.ts",
    "exports/skills": "src/exports/skills.ts",
    "exports/url": "src/exports/url.ts",
    "exports/version": "src/exports/version.ts",
  },
  format: "esm",
  dts: true,
  clean: true,
  shims: true,
  target: "node20.6",
  outputOptions: {
    entryFileNames: "[name].mjs",
    chunkFileNames: "[name]-[hash].mjs",
  },
});
