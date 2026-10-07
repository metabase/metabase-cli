import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isMethodKey, METHOD_KEYS, methodRequirements } from "./requirements";

const RESOURCES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "resources");

const NAMESPACE = /explainer\(transport, "(\w+)"\)/;
// `explain("<name>", <fn>`, `explainWalk("<name>", <fn>` or `refuse("<name>", <fn>`, and whether a
// parameter-feature callback follows the method; or `refuseAfterReading("<name>"`, whose reader
// comes before the method and which takes no callback.
const WRAPPED =
  /\b(?:(?:explain(?:Walk)?|refuse)\(\s*"(\w+)",\s*\w+\s*(,)?|refuseAfterReading\(\s*"(\w+)",)/g;

interface Wiring {
  // One entry per wrapping, so a method wrapped twice appears twice.
  wrapped: string[];
  explainedWithParameters: Set<string>;
}

function readWiring(): Wiring {
  const wiring: Wiring = { wrapped: [], explainedWithParameters: new Set() };
  for (const file of readdirSync(RESOURCES)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) {
      continue;
    }
    const source = readFileSync(resolve(RESOURCES, file), "utf8");
    const namespace = NAMESPACE.exec(source)?.[1];
    if (namespace === undefined) {
      continue;
    }
    for (const [, wrappedName, parameters, readingName] of source.matchAll(WRAPPED)) {
      const name = wrappedName ?? readingName;
      if (name === undefined) {
        continue;
      }
      const key = `${namespace}.${name}`;
      wiring.wrapped.push(key);
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
  // error instead of the feature the server lacks. A method refused before the request is never
  // the server's to refuse, so explaining it as well would have nothing to explain.
  it("wraps every method that needs a feature exactly once", () => {
    const miswrapped = METHOD_KEYS.filter(
      (key) =>
        methodRequirements(key).length > 0 &&
        wiring.wrapped.filter((wrapped) => wrapped === key).length !== 1,
    );
    expect(miswrapped).toEqual([]);
  });

  it("wraps nothing that could have no feature to name", () => {
    const pointless = [...new Set(wiring.wrapped)].filter(
      (key) =>
        isMethodKey(key) &&
        methodRequirements(key).length === 0 &&
        !wiring.explainedWithParameters.has(key),
    );
    expect(pointless).toEqual([]);
  });
});
