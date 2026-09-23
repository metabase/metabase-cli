import { describe, expect, it } from "vitest";

import { GitFailure } from "./service";
import { joinDiffFiles, parseNameStatus, parseNumstat } from "./diff";

const NUL = "\0";

function records(...fields: string[]): string {
  return `${fields.join(NUL)}${NUL}`;
}

describe("parseNumstat", () => {
  it("reads a plain record's counts and path", () => {
    expect(parseNumstat(records("12\t3\ttransforms/orders_clean.yaml"))).toEqual([
      { path: "transforms/orders_clean.yaml", added: 12, removed: 3, binary: false },
    ]);
  });

  it("reports a binary file as zero lines changed and says it is binary", () => {
    expect(parseNumstat(records("-\t-\tdocs/diagram.png"))).toEqual([
      { path: "docs/diagram.png", added: 0, removed: 0, binary: true },
    ]);
  });

  it("takes the destination of a rename, whose name git prints two records later", () => {
    const stdout = records(
      "1\t1\t",
      "transforms/old.yaml",
      "transforms/new.yaml",
      "4\t0\tREADME.md",
    );
    expect(parseNumstat(stdout)).toEqual([
      { path: "transforms/new.yaml", added: 1, removed: 1, binary: false },
      { path: "README.md", added: 4, removed: 0, binary: false },
    ]);
  });

  it("reads nothing from an empty diff", () => {
    expect(parseNumstat("")).toEqual([]);
  });

  it("refuses a record it cannot read rather than skipping it", () => {
    expect(() => parseNumstat(records("not a numstat record"))).toThrow(GitFailure);
    expect(() => parseNumstat(records("not a numstat record"))).toThrow(
      "git printed a numstat record it does not document: not a numstat record",
    );
  });

  it("refuses a rename whose destination git never printed", () => {
    expect(() => parseNumstat(records("1\t1\t", "transforms/old.yaml"))).toThrow(
      "git printed a rename with no destination: 1\t1\t",
    );
  });
});

describe("parseNameStatus", () => {
  it("reads an added, a modified and a deleted file", () => {
    const stdout = records(
      "A",
      "models/orders.yaml",
      "M",
      "transforms/orders_clean.yaml",
      "D",
      "cards/old_report.yaml",
    );
    expect(parseNameStatus(stdout)).toEqual([
      { path: "models/orders.yaml", previousPath: null, change: "added" },
      { path: "transforms/orders_clean.yaml", previousPath: null, change: "modified" },
      { path: "cards/old_report.yaml", previousPath: null, change: "deleted" },
    ]);
  });

  it("reads a rename's similarity score as a rename from the first path to the second", () => {
    expect(parseNameStatus(records("R086", "cards/old.yaml", "cards/new.yaml"))).toEqual([
      { path: "cards/new.yaml", previousPath: "cards/old.yaml", change: "renamed" },
    ]);
  });

  it("reads a type change as a modification of the same path", () => {
    expect(parseNameStatus(records("T", "snippets/link.sql"))).toEqual([
      { path: "snippets/link.sql", previousPath: null, change: "modified" },
    ]);
  });

  it("refuses a status letter it does not document", () => {
    expect(() => parseNameStatus(records("X", "cards/a.yaml"))).toThrow(
      "git printed a name-status record it does not document: X",
    );
  });

  it("refuses a rename whose destination git never printed", () => {
    expect(() => parseNameStatus(records("R100", "cards/old.yaml"))).toThrow(
      "git printed a rename with no destination: R100",
    );
  });
});

describe("joinDiffFiles", () => {
  it("puts each file's counts beside its status", () => {
    const statuses = parseNameStatus(records("R090", "cards/old.yaml", "cards/new.yaml"));
    const counts = parseNumstat(records("2\t1\t", "cards/old.yaml", "cards/new.yaml"));
    expect(joinDiffFiles(statuses, counts)).toEqual([
      {
        path: "cards/new.yaml",
        previousPath: "cards/old.yaml",
        change: "renamed",
        added: 2,
        removed: 1,
        binary: false,
      },
    ]);
  });

  it("refuses a status with no line counts rather than inventing them", () => {
    const statuses = parseNameStatus(records("M", "cards/a.yaml"));
    expect(() => joinDiffFiles(statuses, [])).toThrow(
      "git named cards/a.yaml in the status but not in the line counts.",
    );
  });
});
