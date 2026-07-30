import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { defineConfig } from "tsdown";

import manifest from "./package.json" with { type: "json" };

const OUT_DIR = "dist";
const DIST_PREFIX = `./${OUT_DIR}/`;
const SRC_PREFIX = "./src/";
const JS_SUFFIX = ".js";
const TS_SUFFIX = ".ts";
const TEST_SUFFIX = ".test.ts";

// The export map is the surface, so it is also the entry list: a module the map does not name has no
// business getting its own file in `dist`, and one it does name has to have one.
function entryPoints(): string[] {
  return Object.values(manifest.exports).flatMap((target) => {
    if (target === null || !target.startsWith(DIST_PREFIX)) {
      return [];
    }
    const stem = target.slice(DIST_PREFIX.length, -JS_SUFFIX.length);
    const source = `${SRC_PREFIX}${stem}${TS_SUFFIX}`;
    return source.includes("*") ? expandWildcard(source) : [source];
  });
}

function expandWildcard(pattern: string): string[] {
  const dir = dirname(pattern);
  return readdirSync(join(import.meta.dirname, dir))
    .filter((name) => name.endsWith(TS_SUFFIX) && !name.endsWith(TEST_SUFFIX))
    .map((name) => `${dir}/${name}`)
    .toSorted();
}

export default defineConfig({
  entry: entryPoints(),
  outDir: OUT_DIR,
  format: "esm",
  platform: "node",
  target: "node20.3",
  dts: true,
  // The export map names `.js`, which for a `"type": "module"` package is already unambiguously ESM.
  fixedExtension: false,
  clean: true,
});
