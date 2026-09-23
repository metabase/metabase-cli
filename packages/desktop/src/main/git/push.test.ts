import { describe, expect, it } from "vitest";

import { pushRefusalMessage } from "./push";

const BRANCH = "rde/orders";

describe("pushRefusalMessage", () => {
  it("reads a branch origin has moved past as commits to bring in first", () => {
    const output = [
      "To /tmp/origin.git",
      " ! [rejected]        rde/orders -> rde/orders (fetch first)",
      "error: failed to push some refs to '/tmp/origin.git'",
    ].join("\n");

    expect(pushRefusalMessage(BRANCH, output)).toBe(
      "origin has commits on rde/orders that this branch doesn't. Merge them in, then push again.",
    );
  });

  it("reads a forced push that lost its lease as a branch that moved since the last fetch", () => {
    const output = " ! [rejected]        rde/orders -> rde/orders (stale info)";

    expect(pushRefusalMessage(BRANCH, output)).toBe(
      "rde/orders moved on origin after this checkout last fetched it, so the forced push stopped before overwriting anything. Fetch, look at what changed, then push again.",
    );
  });

  it("names refused credentials before an unreadable remote, which an SSH key refusal also prints", () => {
    const output = [
      "git@github.com: Permission denied (publickey).",
      "fatal: Could not read from remote repository.",
    ].join("\n");

    expect(pushRefusalMessage(BRANCH, output)).toBe(
      "origin turned down the credentials git offered. Check that a terminal can push to this remote, then try again.",
    );
  });

  it("points at the output for a refusal it cannot name", () => {
    expect(pushRefusalMessage(BRANCH, "remote: something new\nerror: failed to push")).toBe(
      "git could not push the branch. The output above says why.",
    );
  });
});
