import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KNOWN_RANGE } from "./profile";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const MATRIX_STACK = /\{ id: "([a-z]+-(?:\d+|head))", image: "([^"]+)"/g;
const CI_STACK = /^\s+- ([a-z]+-(?:\d+|head))$/gm;

function group(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`no capture group ${index} in ${match[0]}`);
  }
  return value;
}

function matrixStacks(): Map<string, string> {
  const source = readFileSync(resolve(REPO_ROOT, "scripts/e2e-matrix.ts"), "utf8");
  return new Map(
    [...source.matchAll(MATRIX_STACK)].map((match) => [group(match, 1), group(match, 2)]),
  );
}

function ciStacks(): string[] {
  const source = readFileSync(resolve(REPO_ROOT, ".github/workflows/e2e.yml"), "utf8");
  return [...source.matchAll(CI_STACK)].map((match) => group(match, 1));
}

function expectedLanes(): string[] {
  const majors = Array.from(
    { length: KNOWN_RANGE.max - KNOWN_RANGE.min + 1 },
    (_, index) => KNOWN_RANGE.min + index,
  );
  return [...majors.map(String), "head"].flatMap((major) => [`oss-${major}`, `ee-${major}`]);
}

describe("every supported major has an e2e lane", () => {
  it("the matrix boots an oss and an ee stack for each major in KNOWN_RANGE, plus head", () => {
    expect([...matrixStacks().keys()]).toEqual(expectedLanes());
  });

  it("CI runs exactly the matrix's lanes", () => {
    expect(ciStacks()).toEqual([...matrixStacks().keys()]);
  });

  it("each released lane pins the image of its own major and edition", () => {
    const released = [...matrixStacks()].filter(([id]) => !id.endsWith("-head"));
    const mismatched = released.filter(([id, image]) => {
      const [edition, major] = id.split("-");
      const repo = edition === "ee" ? "metabase/metabase-enterprise" : "metabase/metabase";
      const semverMajor = edition === "ee" ? 1 : 0;
      return !image.startsWith(`${repo}:v${semverMajor}.${major}.`);
    });
    expect(mismatched).toEqual([]);
  });
});
