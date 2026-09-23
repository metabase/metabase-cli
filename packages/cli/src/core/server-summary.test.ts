import { describe, expect, it } from "vitest";

import type { ServerInfo } from "@metabase/client/version/probe";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";
import { createServerProfile } from "@metabase/client/version/profile";

import { serverChangeNote, skewNotice } from "./server-summary";

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

describe("skewNotice", () => {
  it("is silent inside the known range", () => {
    expect(skewNotice(createServerProfile(serverAt(KNOWN_RANGE.max)))).toBeNull();
  });

  it("points an older server at upgrading Metabase and names the oldest major it supports", () => {
    const below = KNOWN_RANGE.min - 1;
    expect(skewNotice(createServerProfile(serverAt(below)))).toBe(
      `Metabase v0.${below}.0 is older than this CLI supports (v${KNOWN_RANGE.min}+); commands needing a newer feature are refused by name. Upgrade Metabase to v${KNOWN_RANGE.min} or later.`,
    );
  });

  it("names the major a newer server is read as", () => {
    const beyond = KNOWN_RANGE.max + 1;
    expect(skewNotice(createServerProfile(serverAt(beyond)))).toBe(
      `Metabase v0.${beyond}.0 is newer than this CLI supports (up to v${KNOWN_RANGE.max}); commands run as if it were a head build past v${KNOWN_RANGE.max}.`,
    );
  });

  it("says an unparseable version is assumed to have every feature", () => {
    expect(skewNotice(createServerProfile(UNPARSEABLE))).toBe(
      `Could not parse the Metabase version; assuming it has every feature this CLI knows.`,
    );
  });
});

describe("serverChangeNote", () => {
  it("names both tags when the version changed", () => {
    expect(serverChangeNote(serverAt(59), serverAt(63))).toBe(
      "The server's version changed since the last probe (was v0.59.0, now v0.63.0); the cached server probe was refreshed — retry the command.",
    );
  });

  it("describes a version that stopped parsing as unparseable", () => {
    expect(serverChangeNote(serverAt(59), UNPARSEABLE)).toBe(
      "The server's version changed since the last probe (was v0.59.0, now an unparseable version); the cached server probe was refreshed — retry the command.",
    );
  });

  it("reports a premium feature the server started granting under the same version", () => {
    expect(
      serverChangeNote(serverAt(59, { library: false }), serverAt(59, { library: true })),
    ).toBe(
      "The server's premium features changed since the last probe; the cached server probe was refreshed — retry the command.",
    );
  });

  it("reports a premium feature the server stopped granting", () => {
    expect(serverChangeNote(serverAt(59, { library: true }), serverAt(59, null))).toBe(
      "The server's premium features changed since the last probe; the cached server probe was refreshed — retry the command.",
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
