import { describe, expectTypeOf, it } from "vitest";

import { type ParsedVersion } from "../version/tag";

import { type ProfileLastProbe } from "./profile-record";

describe("ProfileLastProbe schema", () => {
  it("infers version as the same shape as ParsedVersion", () => {
    expectTypeOf<ProfileLastProbe["version"]>().toEqualTypeOf<ParsedVersion>();
  });
});
