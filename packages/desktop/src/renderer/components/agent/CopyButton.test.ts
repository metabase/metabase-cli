import { describe, expect, it } from "vitest";

import type { CopyState } from "../../clipboard";

import { copyStatusLabel } from "./CopyButton";

describe("the copy button's label", () => {
  it("follows the state of the last copy", () => {
    const states: readonly CopyState[] = [
      { kind: "idle" },
      { kind: "copied" },
      { kind: "failed", message: "Write permission denied" },
    ];
    expect(states.map(copyStatusLabel)).toEqual(["Copy", "Copied", "Write permission denied"]);
  });
});
