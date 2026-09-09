import { describe, expect, expectTypeOf, it } from "vitest";

import { type ParsedVersion } from "@metabase/client/version/tag";

import { ProfileRecord, type ProfileLastProbe } from "./profile-record";

describe("ProfileLastProbe schema", () => {
  it("infers version as a nullable ParsedVersion (null for head/nightly builds)", () => {
    expectTypeOf<ProfileLastProbe["version"]>().toEqualTypeOf<ParsedVersion | null>();
  });
});

describe("ProfileRecord worktree pin", () => {
  it("defaults to null so a profile written before pinning existed still parses", () => {
    const parsed = ProfileRecord.parse({
      name: "default",
      url: "https://m.example.com",
      apiKey: "k",
      lastProbe: null,
      lastFailure: null,
    });
    expect(parsed.worktree).toBeNull();
  });

  it("fails loudly on a malformed pin rather than falling back to the null default", () => {
    const result = ProfileRecord.safeParse({
      name: "default",
      url: "https://m.example.com",
      apiKey: "k",
      lastProbe: null,
      lastFailure: null,
      worktree: { id: 0, branch: "feat/x" },
    });
    expect(result.success).toBe(false);
  });
});
