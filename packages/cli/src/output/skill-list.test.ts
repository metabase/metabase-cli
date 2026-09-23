import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerProfile } from "@metabase/client/version/profile";

import type { SkillServerLookup } from "../core/skill-server";
import type { UnavailableSkill } from "../core/skills";
import { renderSkillList, skillFilterNotices, type SkillListRow } from "./skill-list";

interface Streams {
  stdout: string;
  stderr: string;
}

let streams: Streams;
let originalColumns: number | undefined;

beforeEach(() => {
  streams = { stdout: "", stderr: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    streams.stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    streams.stderr += String(chunk);
    return true;
  });
  originalColumns = process.stdout.columns;
  Object.defineProperty(process.stdout, "columns", { value: 40, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, "columns", {
    value: originalColumns,
    configurable: true,
  });
});

const rows: SkillListRow[] = [
  { name: "core", description: "Drive a Metabase instance from the terminal." },
  { name: "mbql", description: "Author Metabase Query Language." },
];

describe("renderSkillList", () => {
  it("prints each skill name on its own line with the description wrapped and indented below", () => {
    renderSkillList(rows, 0);
    expect(streams.stdout).toBe(
      "core\n" +
        "  Drive a Metabase instance from the\n" +
        "  terminal.\n\n" +
        "mbql\n" +
        "  Author Metabase Query Language.\n\n",
    );
    expect(streams.stderr).toBe("");
  });

  it("emits a no-results marker for an empty list", () => {
    renderSkillList([], 0);
    expect(streams.stdout).toBe("(no results)\n");
  });

  it("drops trailing skills past the byte cap and warns with the full byte count", () => {
    const full =
      "core\n  Drive a Metabase instance from the\n  terminal.\n\nmbql\n  Author Metabase Query Language.\n\n";
    const firstBlockBytes = Buffer.byteLength(
      "core\n  Drive a Metabase instance from the\n  terminal.\n\n",
      "utf8",
    );

    renderSkillList(rows, firstBlockBytes);

    expect(streams.stdout).toBe("core\n  Drive a Metabase instance from the\n  terminal.\n\n");
    expect(streams.stderr).toBe(
      `… cut at ${Buffer.byteLength(full, "utf8")} bytes; narrow the selection or raise --max-bytes\n`,
    );
  });
});

describe("skillFilterNotices", () => {
  const skipped: UnavailableSkill[] = [
    {
      name: "transform",
      failure: {
        reason: "version-too-old",
        detail:
          "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
        feature: "transforms",
        since: 59,
        tokenFeature: null,
        serverVersion: "v0.58.0",
      },
    },
  ];

  const probed: SkillServerLookup = {
    kind: "found",
    profile: createServerProfile({
      edition: "oss",
      version: { tag: "v0.58.0", major: 58, patch: 0 },
      date: null,
      hash: null,
      tokenFeatures: null,
    }),
  };

  it("says nothing when the filter was bypassed", () => {
    expect(skillFilterNotices(skipped, null)).toEqual([]);
    expect(skillFilterNotices(null, null)).toEqual([]);
  });

  it("says why there was no server to filter by", () => {
    expect(
      skillFilterNotices(null, {
        kind: "no-credential",
        reason: "no Metabase credential; run inside Metabase RDE, or set MB_URL and MB_API_KEY",
      }),
    ).toEqual([
      "Skills are unfiltered: no Metabase credential; run inside Metabase RDE, or set MB_URL and MB_API_KEY.",
    ]);
    expect(
      skillFilterNotices(null, { kind: "unreachable", reason: "Metabase returned 503." }),
    ).toEqual(["Skills are unfiltered: the server could not be probed (Metabase returned 503.)."]);
  });

  it("names each skipped skill with the client's reason and the way around it", () => {
    expect(skillFilterNotices(skipped, probed)).toEqual([
      'Skipped skill "transform": This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it. Pass --unfiltered to print it anyway.',
    ]);
    expect(skillFilterNotices([], probed)).toEqual([]);
  });
});
