import { describe, expect, it } from "vitest";

import type { ServerInfo } from "@metabase/client/version/probe";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";
import { createServerProfile } from "@metabase/client/version/profile";

import { serverChangeNote, skewNotice, summarizeServer } from "./server-summary";

function serverAt(major: number, tokenFeatures: ServerInfo["tokenFeatures"] = null): ServerInfo {
  return {
    edition: "oss",
    version: { tag: `v0.${major}.0`, major, patch: 0 },
    date: null,
    hash: null,
    tokenFeatures,
  };
}

const UNPARSEABLE: ServerInfo = {
  version: null,
  edition: null,
  date: null,
  hash: null,
  tokenFeatures: null,
};

describe("summarizeServer", () => {
  it("reports every server fact as null without a probe and still names the CLI's own range", () => {
    expect(summarizeServer(null)).toEqual({
      version: null,
      edition: null,
      skew: null,
      knownRange: { min: KNOWN_RANGE.min, max: KNOWN_RANGE.max },
      tokenFeatures: null,
      features: null,
    });
  });

  it("carries the profile's derived facts beside the raw probe", () => {
    const info = serverAt(KNOWN_RANGE.min, { library: true });
    const profile = createServerProfile(info);
    expect(summarizeServer(info)).toEqual({
      version: info.version,
      edition: "oss",
      skew: "supported",
      knownRange: { min: KNOWN_RANGE.min, max: KNOWN_RANGE.max },
      tokenFeatures: { library: true },
      features: profile.features,
    });
  });
});

describe("skewNotice", () => {
  it("is silent inside the known range", () => {
    expect(skewNotice(createServerProfile(serverAt(KNOWN_RANGE.max)))).toBeNull();
  });

  it("points a newer server at mb upgrade and names the major it is read as", () => {
    const beyond = KNOWN_RANGE.max + 1;
    expect(skewNotice(createServerProfile(serverAt(beyond)))).toBe(
      `Metabase v0.${beyond}.0 is newer than this CLI supports (up to v${KNOWN_RANGE.max}); commands run as if it were a head build past v${KNOWN_RANGE.max}. Run \`mb upgrade\` for a newer CLI.`,
    );
  });

  it("says an unparseable version is read as a head build", () => {
    expect(skewNotice(createServerProfile(UNPARSEABLE))).toBe(
      `Could not parse the Metabase version; assuming a head build past v${KNOWN_RANGE.max}.`,
    );
  });
});

describe("serverChangeNote", () => {
  it("names both tags when the version changed", () => {
    expect(serverChangeNote(serverAt(59), serverAt(63))).toBe(
      "The server's version changed since the last probe (was v0.59.0, now v0.63.0); the profile was refreshed — retry the command.",
    );
  });

  it("describes a version that stopped parsing as unparseable", () => {
    expect(serverChangeNote(serverAt(59), UNPARSEABLE)).toBe(
      "The server's version changed since the last probe (was v0.59.0, now an unparseable version); the profile was refreshed — retry the command.",
    );
  });

  it("reports a premium feature the server started granting under the same version", () => {
    expect(
      serverChangeNote(serverAt(59, { library: false }), serverAt(59, { library: true })),
    ).toBe(
      "The server's premium features changed since the last probe; the profile was refreshed — retry the command.",
    );
  });

  it("reports a premium feature the server stopped granting", () => {
    expect(serverChangeNote(serverAt(59, { library: true }), serverAt(59, null))).toBe(
      "The server's premium features changed since the last probe; the profile was refreshed — retry the command.",
    );
  });

  it("treats an unreported map, an empty one, and a denied feature as the same grants", () => {
    expect(serverChangeNote(serverAt(59, null), serverAt(59, {}))).toBeNull();
    expect(serverChangeNote(serverAt(59, {}), serverAt(59, { library: false }))).toBeNull();
  });

  it("is null when tag and grants agree even though the build moved", () => {
    const cached = serverAt(59, { library: true });
    const fresh: ServerInfo = { ...cached, date: "2026-09-16", hash: "abc1234" };
    expect(serverChangeNote(cached, fresh)).toBeNull();
  });
});
