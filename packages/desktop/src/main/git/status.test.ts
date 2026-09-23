import { describe, expect, it } from "vitest";

import { GitFailure } from "./service";
import { parsePorcelainStatus } from "./status";

const NUL = "\0";

function porcelain(...fields: string[]): string {
  return `${fields.join(NUL)}${NUL}`;
}

const OID = "# branch.oid 4f2d0c1b9a8e7d6c5b4a39281706f5e4d3c2b1a0";

describe("parsePorcelainStatus", () => {
  it("reads a clean branch that is level with its upstream", () => {
    const stdout = porcelain(
      OID,
      "# branch.head rde/clean-orders",
      "# branch.upstream origin/rde/clean-orders",
      "# branch.ab +0 -0",
    );
    expect(parsePorcelainStatus(stdout)).toEqual({
      branch: "rde/clean-orders",
      upstream: {
        kind: "tracking",
        divergence: { against: "origin/rde/clean-orders", ahead: 0, behind: 0 },
      },
      clean: true,
    });
  });

  it("reads how far a branch is ahead of and behind its upstream", () => {
    const stdout = porcelain(
      OID,
      "# branch.head rde/clean-orders",
      "# branch.upstream origin/rde/clean-orders",
      "# branch.ab +3 -1",
    );
    expect(parsePorcelainStatus(stdout).upstream).toEqual({
      kind: "tracking",
      divergence: { against: "origin/rde/clean-orders", ahead: 3, behind: 1 },
    });
  });

  it("reads a branch that was never pushed as having no upstream", () => {
    const stdout = porcelain(OID, "# branch.head rde/clean-orders");
    expect(parsePorcelainStatus(stdout)).toEqual({
      branch: "rde/clean-orders",
      upstream: { kind: "none" },
      clean: true,
    });
  });

  it("tells an upstream the remote deleted apart from a branch that was never pushed", () => {
    const stdout = porcelain(
      OID,
      "# branch.head rde/clean-orders",
      "# branch.upstream origin/rde/clean-orders",
    );
    expect(parsePorcelainStatus(stdout).upstream).toEqual({
      kind: "gone",
      name: "origin/rde/clean-orders",
    });
  });

  it("reads a detached HEAD as naming no branch", () => {
    const stdout = porcelain(OID, "# branch.head (detached)");
    expect(parsePorcelainStatus(stdout).branch).toBeNull();
  });

  it("reads changed, renamed and untracked entries as a checkout that is not clean", () => {
    const stdout = porcelain(
      OID,
      "# branch.head main",
      "1 .M N... 100644 100644 100644 aaaa bbbb transforms/orders_clean.yaml",
      "2 R. N... 100644 100644 100644 aaaa bbbb R100 cards/new.yaml",
      "cards/old.yaml",
      "? models/orders.yaml",
    );
    expect(parsePorcelainStatus(stdout)).toEqual({
      branch: "main",
      upstream: { kind: "none" },
      clean: false,
    });
  });

  it("refuses an ahead/behind header it does not document", () => {
    const stdout = porcelain(
      OID,
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab ahead 1",
    );
    expect(() => parsePorcelainStatus(stdout)).toThrow(GitFailure);
    expect(() => parsePorcelainStatus(stdout)).toThrow(
      "git printed an ahead/behind header it does not document: ahead 1",
    );
  });
});
