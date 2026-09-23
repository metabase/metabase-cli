import { describe, expect, it } from "vitest";

import type { TurnFold } from "./rows";
import { changeLabel, durationLabel, filesLabel, foldLabel } from "./labels";

const PLAIN_FOLD: TurnFold = {
  toolCalls: 0,
  filesChanged: 0,
  durationMs: 41_000,
  outcome: { kind: "completed" },
};

function fold(part: Partial<TurnFold>): TurnFold {
  return { ...PLAIN_FOLD, ...part };
}

describe("saying how long something took", () => {
  it("rounds to whole seconds under a minute", () => {
    expect(durationLabel(41_400)).toBe("41 s");
  });

  it("splits a longer stretch into minutes and seconds", () => {
    expect(durationLabel(80_000)).toBe("1 min 20 s");
  });

  it("says a minute flat without a stray second", () => {
    expect(durationLabel(60_000)).toBe("1 min 0 s");
  });
});

describe("what a folded turn says about itself", () => {
  it("counts the calls, the files and the time", () => {
    expect(foldLabel(fold({ toolCalls: 3, filesChanged: 2 }))).toBe(
      "3 tool calls, 2 files changed, 41 s",
    );
  });

  it("writes a single call and a single file in the singular", () => {
    expect(foldLabel(fold({ toolCalls: 1, filesChanged: 1 }))).toBe(
      "1 tool call, 1 file changed, 41 s",
    );
  });

  it("leaves out a count of nothing", () => {
    expect(foldLabel(fold({ toolCalls: 2 }))).toBe("2 tool calls, 41 s");
  });

  it("says the user stopped it rather than counting what it managed", () => {
    expect(foldLabel(fold({ toolCalls: 3, outcome: { kind: "interrupted" } }))).toBe(
      "Stopped after 41 s",
    );
  });

  it("says a turn failed", () => {
    expect(foldLabel(fold({ outcome: { kind: "failed", message: "the model refused" } }))).toBe(
      "Failed after 41 s",
    );
  });
});

describe("saying what changed", () => {
  it("writes a file's added and removed lines", () => {
    expect(changeLabel(12, 3)).toBe("+12 −3");
  });

  it("names an empty checkpoint rather than showing a zero", () => {
    expect(filesLabel(0)).toBe("no files changed");
  });

  it("counts one file in the singular", () => {
    expect(filesLabel(1)).toBe("1 file changed");
  });
});
