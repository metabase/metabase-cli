import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";
import { parseTag, type ReleaseVersion } from "@metabase/client/version/tag";

import { pickSdkRelease, requireReleaseBuild, type SdkRelease } from "./embedding-sdk";

const RELEASE_65: ReleaseVersion = { kind: "release", tag: "v1.65.1", major: 65, patch: 1 };
const PRERELEASE_66: ReleaseVersion = { kind: "release", tag: "v1.66.0-beta", major: 66, patch: 0 };

describe("requireReleaseBuild", () => {
  it("refuses a development build, which no published SDK matches", () => {
    const refused = (): ReleaseVersion => requireReleaseBuild(parseTag("vUNKNOWN"));
    expect(refused).toThrow(ConfigError);
    expect(refused).toThrow(
      "Metabase development build vUNKNOWN matches no published @metabase/embedding-sdk-react release — install an SDK built from the same Metabase source",
    );
  });
});

describe("pickSdkRelease", () => {
  it("picks the major's stable tag over its pre-releases", () => {
    const distTags = {
      latest: "0.65.1",
      "65-alpha": "0.65.0-alpha.0",
      "65-beta": "0.65.0-beta.1",
      "65-stable": "0.65.1",
      "66-alpha": "0.66.0-alpha.0",
    };
    expect(pickSdkRelease(RELEASE_65, distTags)).toEqual({ tag: "65-stable", version: "0.65.1" });
  });

  it("picks the major's beta while it has no stable tag", () => {
    const distTags = {
      latest: "0.65.1",
      "65-stable": "0.65.1",
      "66-alpha": "0.66.0-alpha.0",
      "66-beta": "0.66.0-beta.0",
    };
    expect(pickSdkRelease(PRERELEASE_66, distTags)).toEqual({
      tag: "66-beta",
      version: "0.66.0-beta.0",
    });
  });

  it("picks the major's alpha while it has neither a stable nor a beta tag", () => {
    const distTags = { latest: "0.65.1", "65-stable": "0.65.1", "66-alpha": "0.66.0-alpha.0" };
    expect(pickSdkRelease(PRERELEASE_66, distTags)).toEqual({
      tag: "66-alpha",
      version: "0.66.0-alpha.0",
    });
  });

  it("refuses a major npm publishes no tag for, rather than another major's SDK", () => {
    const distTags = { latest: "0.65.1", "65-stable": "0.65.1", nightly: "0.66.1-nightly" };
    const refused = (): SdkRelease => pickSdkRelease(PRERELEASE_66, distTags);
    expect(refused).toThrow(ConfigError);
    expect(refused).toThrow(
      "npm publishes no @metabase/embedding-sdk-react tag for Metabase v1.66.0-beta (looked for 66-stable, 66-beta, 66-alpha)",
    );
  });
});
