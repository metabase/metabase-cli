import { describe, expect, it } from "vitest";

import { inlineCodeSegments } from "./inline-code";

describe("inlineCodeSegments", () => {
  it("sets each stretch between backticks as code", () => {
    expect(inlineCodeSegments("Codex is signed out. Run `codex login`, then rescan.")).toEqual([
      { text: "Codex is signed out. Run ", code: false },
      { text: "codex login", code: true },
      { text: ", then rescan.", code: false },
    ]);
  });

  it("leaves a message with an unpaired backtick as it is", () => {
    expect(inlineCodeSegments("a ` b")).toEqual([{ text: "a ` b", code: false }]);
  });
});
