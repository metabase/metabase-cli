import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderSkillList, type SkillListRow } from "./skill-list";

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
      `… cut at ${Buffer.byteLength(full, "utf8")} bytes; rerun with --max-bytes 0\n`,
    );
  });
});
