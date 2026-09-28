import { describe, expectTypeOf, it } from "vitest";

import { type ServerVersion } from "@metabase/client/version/tag";

import { type ProfileLastProbe } from "./profile-record";

describe("ProfileLastProbe schema", () => {
  it("infers version as a ServerVersion", () => {
    expectTypeOf<ProfileLastProbe["version"]>().toEqualTypeOf<ServerVersion>();
  });
});
