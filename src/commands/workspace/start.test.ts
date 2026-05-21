import { describe, expect, it } from "vitest";

import { tryParseTag } from "../../core/version/tag";

import { resolveDefaultImage } from "./start";

describe("resolveDefaultImage", () => {
  it("uses the head build when the server version is unknown", () => {
    expect(resolveDefaultImage(null)).toBe("metabase/metabase-enterprise-head:latest");
  });

  it("uses the head build for versions older than the first workspaces release", () => {
    expect(resolveDefaultImage(tryParseTag("v1.61.2"))).toBe(
      "metabase/metabase-enterprise-head:latest",
    );
  });

  it("uses the released enterprise build from the first workspaces release onward", () => {
    expect(resolveDefaultImage(tryParseTag("v1.62.0"))).toBe("metabase/metabase-enterprise:latest");
    expect(resolveDefaultImage(tryParseTag("v1.63.5"))).toBe("metabase/metabase-enterprise:latest");
  });
});
