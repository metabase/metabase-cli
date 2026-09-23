import { describe, expect, it } from "vitest";

import type { DiffFile } from "../../contracts/changes";

import { changeTotals, changesIn, countsLabel, totalsLine, treeExpansion } from "./files";

const MODIFIED: DiffFile = {
  path: "transforms/orders.sql",
  previousPath: null,
  change: "modified",
  added: 3,
  removed: 1,
  binary: false,
};

const IMAGE: DiffFile = {
  path: "docs/diagram.png",
  previousPath: null,
  change: "added",
  added: 0,
  removed: 0,
  binary: true,
};

describe("changeTotals", () => {
  it("adds up the files and their lines", () => {
    expect(changeTotals([MODIFIED, IMAGE])).toEqual({ files: 2, added: 3, removed: 1 });
  });
});

describe("totalsLine", () => {
  it("counts one file in the singular and more in the plural", () => {
    expect(totalsLine({ files: 1, added: 0, removed: 0 })).toBe("1 file changed");
    expect(totalsLine({ files: 4, added: 0, removed: 0 })).toBe("4 files changed");
  });
});

describe("countsLabel", () => {
  it("shows a text file's lines and says a binary file is binary", () => {
    expect(countsLabel(MODIFIED)).toBe("+3 −1");
    expect(countsLabel(IMAGE)).toBe("binary");
  });
});

describe("treeExpansion", () => {
  it("opens a tree short enough to read whole", () => {
    expect(treeExpansion(200)).toBe("open");
  });

  it("folds a longer one", () => {
    expect(treeExpansion(201)).toBe("closed");
  });
});

describe("changesIn", () => {
  it("keeps the changes the tree has a row for and drops a deleted file's", () => {
    const deleted: DiffFile = { ...MODIFIED, path: "models/orders.yaml", change: "deleted" };

    expect(changesIn(["transforms/orders.sql", "README.md"], [MODIFIED, deleted])).toEqual([
      MODIFIED,
    ]);
  });
});
