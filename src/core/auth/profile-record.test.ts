import { describe, expectTypeOf, it } from "vitest";

import { type ParsedVersion } from "../version/tag";

import { type ProfileLastProbe } from "./profile-record";

describe("ProfileLastProbe schema", () => {
  it("infers version as a nullable ParsedVersion (null for head/nightly builds)", () => {
    expectTypeOf<ProfileLastProbe["version"]>().toEqualTypeOf<ParsedVersion | null>();
  });
});
