import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { type Stack, STACKS } from "../../../../scripts/e2e-stacks";

import { KNOWN_RANGE } from "./known-range";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const WORKFLOW = resolve(REPO_ROOT, ".github/workflows/e2e.yml");

const Workflow = z.object({
  jobs: z.object({
    e2e: z.object({
      strategy: z.object({
        matrix: z.object({ stack: z.array(z.string()) }),
      }),
    }),
  }),
});

function ciStacks(): string[] {
  const workflow = Workflow.parse(yaml.load(readFileSync(WORKFLOW, "utf8")));
  return workflow.jobs.e2e.strategy.matrix.stack;
}

function expectedLanes(): string[] {
  const majors = Array.from(
    { length: KNOWN_RANGE.max - KNOWN_RANGE.min + 1 },
    (_, index) => KNOWN_RANGE.min + index,
  );
  return [...majors.map(String), "head"].flatMap((major) => [`oss-${major}`, `ee-${major}`]);
}

function pinsOwnMajorAndEdition(stack: Stack): boolean {
  const [edition, major] = stack.id.split("-");
  const repo = edition === "ee" ? "metabase/metabase-enterprise" : "metabase/metabase";
  const semverMajor = edition === "ee" ? 1 : 0;
  return stack.image.startsWith(`${repo}:v${semverMajor}.${major}.`);
}

describe("every supported major has an e2e lane", () => {
  const stackIds = STACKS.map((stack) => stack.id);

  it("the matrix boots an oss and an ee stack for each major in KNOWN_RANGE, plus head", () => {
    expect(stackIds).toEqual(expectedLanes());
  });

  it("CI runs exactly the matrix's lanes", () => {
    expect(ciStacks()).toEqual(stackIds);
  });

  it("each released lane pins the image of its own major and edition", () => {
    const released = STACKS.filter((stack) => !stack.id.endsWith("-head"));
    expect(released.filter((stack) => !pinsOwnMajorAndEdition(stack))).toEqual([]);
  });
});
