import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { TEST_USER_AGENT } from "../testing/fetch-capture";

import { FEATURE_RULES, type FeatureRule } from "./features";
import { isMethodKey, METHOD_REQUIREMENTS, methodRequirements } from "./requirements";

const CREDENTIALS: ClientCredentials = {
  url: "https://m.example.com",
  credential: { kind: "apiKey", apiKey: "mb_requirements_key" },
};

const ESCAPE_HATCHES: ReadonlySet<string> = new Set([
  "server",
  "requestParsed",
  "requestRaw",
  "requestStream",
]);

const TABLE_KEYS: ReadonlyArray<string> = Object.keys(METHOD_REQUIREMENTS).toSorted();

const noNetwork: typeof fetch = () => {
  throw new Error("the requirements table is enumerated without a socket");
};

function methodKeysOnClient(): string[] {
  const client = createClient(CREDENTIALS, { userAgent: TEST_USER_AGENT, fetchImpl: noNetwork });
  const keys: string[] = [];
  for (const [namespace, resource] of Object.entries(client)) {
    if (ESCAPE_HATCHES.has(namespace) || typeof resource !== "object" || resource === null) {
      continue;
    }
    for (const [method, value] of Object.entries(resource)) {
      if (typeof value === "function") {
        keys.push(`${namespace}.${method}`);
      }
    }
  }
  return keys.toSorted();
}

describe("METHOD_REQUIREMENTS", () => {
  it("names exactly the methods the client exposes", () => {
    expect(methodKeysOnClient()).toEqual(TABLE_KEYS);
  });

  // A requirement says the route exists on the server; a rule that ends at some major describes
  // a shape an older server had, and refusing on it would name a floor the server is above.
  it("requires no feature bounded by `until`", () => {
    const bounded = Object.entries(METHOD_REQUIREMENTS).flatMap(([key, features]) =>
      features
        .filter((feature) => {
          const rule: FeatureRule = FEATURE_RULES[feature];
          return rule.until !== undefined;
        })
        .map((feature) => `${key}: ${feature}`),
    );
    expect(bounded).toEqual([]);
  });
});

describe("isMethodKey", () => {
  it("admits a key the table names and refuses one it does not", () => {
    expect(isMethodKey("card.list")).toBe(true);
    expect(isMethodKey("card.explode")).toBe(false);
  });
});

describe("methodRequirements", () => {
  it("answers the table's own entry", () => {
    expect(methodRequirements("transformJob.setActive")).toEqual([
      "transformJobActivation",
      "transforms",
    ]);
    expect(methodRequirements("card.list")).toEqual([]);
  });
});
