import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isMethodKey, METHOD_KEYS, methodRequirements } from "./requirements";

const RESOURCES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "resources");

const NAMESPACE = /explainer\(transport, "(\w+)"\)/;
// `explain("<name>", <fn>` and whether a parameter-feature callback follows the method.
const EXPLAINED = /\bexplain\(\s*"(\w+)",\s*\w+\s*(,)?/g;
const PAGED = /methodRequirements\("(\w+\.\w+)"\)/g;

// Methods whose whole requirement guards a parameter a server without it would drop, so they refuse
// before the request through `requireFeatures` and the server never gets to refuse them.
const REFUSED_BEFORE_THE_REQUEST: ReadonlySet<string> = new Set(["field.setDataSensitivity"]);

interface Wiring {
  explained: Set<string>;
  explainedWithParameters: Set<string>;
  paged: Set<string>;
}

function readWiring(): Wiring {
  const wiring: Wiring = {
    explained: new Set(),
    explainedWithParameters: new Set(),
    paged: new Set(),
  };
  for (const file of readdirSync(RESOURCES)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) {
      continue;
    }
    const source = readFileSync(resolve(RESOURCES, file), "utf8");
    for (const [, key] of source.matchAll(PAGED)) {
      if (key !== undefined) {
        wiring.paged.add(key);
      }
    }
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
  it("wraps every method that needs a feature, or hands its features to the page walk", () => {
    const unexplained = METHOD_KEYS.filter(
      (key) =>
        methodRequirements(key).length > 0 &&
        !wiring.explained.has(key) &&
        !wiring.paged.has(key) &&
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
