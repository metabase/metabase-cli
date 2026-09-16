import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("says nothing when the filter was bypassed", () => {
    expect(skillFilterNotices(skipped, { profileName: "default", bypassed: true })).toEqual([]);
    expect(skillFilterNotices(null, { profileName: "default", bypassed: true })).toEqual([]);
  });

  it("names the profile that had no probe to filter by", () => {
    expect(skillFilterNotices(null, { profileName: "staging", bypassed: false })).toEqual([
      'Skills are unfiltered: profile "staging" has no cached server probe (run `mb auth list` to record one).',
    ]);
  });

  it("names each skipped skill with the client's reason and the way around it", () => {
    expect(skillFilterNotices(skipped, { profileName: "default", bypassed: false })).toEqual([
      'Skipped skill "transform": This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it. Pass --all to print it anyway.',
    ]);
    expect(skillFilterNotices([], { profileName: "default", bypassed: false })).toEqual([]);
  });
});
