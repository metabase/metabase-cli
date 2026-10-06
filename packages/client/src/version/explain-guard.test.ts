import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isMethodKey, METHOD_KEYS, methodRequirements } from "./requirements";

const RESOURCES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "resources");

const NAMESPACE = /explainer\(transport, "(\w+)"\)/;
// `explain("<name>", <fn>` or `explainWalk("<name>", <fn>`, and whether a parameter-feature
// callback follows the method.
const EXPLAINED = /\bexplain(?:Walk)?\(\s*"(\w+)",\s*\w+\s*(,)?/g;

// Methods whose whole requirement guards an answer a server without it would give wrongly without
// a word, so they refuse before the request through `requireFeatures` and the server never gets to
// refuse them.
const REFUSED_BEFORE_THE_REQUEST: ReadonlySet<string> = new Set([
  "field.setDataSensitivity",
  "gitSync.syncedCollections",
  "gitSync.branch",
  "gitSync.trackedBranch",
]);

interface Wiring {
  explained: Set<string>;
  explainedWithParameters: Set<string>;
}

function readWiring(): Wiring {
  const wiring: Wiring = { explained: new Set(), explainedWithParameters: new Set() };
  for (const file of readdirSync(RESOURCES)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) {
      continue;
    }
    const source = readFileSync(resolve(RESOURCES, file), "utf8");
    const namespace = NAMESPACE.exec(source)?.[1];
    if (namespace === undefined) {
      continue;
    }
    for (const [, name, parameters] of source.matchAll(EXPLAINED)) {
      if (name === undefined) {
        continue;
      }
      const key = `${namespace}.${name}`;
      wiring.explained.add(key);
      if (parameters !== undefined) {
        wiring.explainedWithParameters.add(key);
      }
    }
  }
  return wiring;
}

describe("the explanation of gated methods", () => {
  const wiring = readWiring();

  // An unwrapped gated method still works; its refusal just reaches the caller as a bare HTTP
  // error instead of the feature the server lacks.
  it("wraps every method that needs a feature", () => {
    const unexplained = METHOD_KEYS.filter(
      (key) =>
        methodRequirements(key).length > 0 &&
        !wiring.explained.has(key) &&
        !REFUSED_BEFORE_THE_REQUEST.has(key),
    );
    expect(unexplained).toEqual([]);
  });

  it("wraps nothing that could have no feature to name", () => {
    const pointless = [...wiring.explained].filter(
      (key) =>
        isMethodKey(key) &&
        methodRequirements(key).length === 0 &&
        !wiring.explainedWithParameters.has(key),
    );
    expect(pointless).toEqual([]);
  });
});
