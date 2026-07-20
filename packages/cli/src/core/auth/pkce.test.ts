import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generatePkce, randomState } from "./pkce";

function expectedChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("generatePkce", () => {
  it("produces a 43-char base64url verifier and its S256 challenge", () => {
    const pkce = generatePkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toBe(expectedChallenge(pkce.verifier));
  });

  it("produces a distinct verifier each call", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });
});

describe("randomState", () => {
  it("produces a non-empty base64url string that varies per call", () => {
    const state = randomState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state).not.toBe(randomState());
  });
});
