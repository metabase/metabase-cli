import { describe, expect, it } from "vitest";

import type { KeyPress } from "./keybindings";
import { KEY_BINDINGS, actionFor, chordName } from "./keybindings";

function press(key: string, held: Partial<KeyPress>): KeyPress {
  return {
    key,
    metaKey: held.metaKey ?? false,
    ctrlKey: held.ctrlKey ?? false,
    shiftKey: held.shiftKey ?? false,
    altKey: held.altKey ?? false,
  };
}

describe("the keybinding table", () => {
  it("gives no two bindings in one scope the same chord", () => {
    const seen = KEY_BINDINGS.map(
      (binding) =>
        `${binding.scope} ${binding.chord.key} mod=${String(binding.chord.mod)} shift=${String(binding.chord.shift)}`,
    );
    expect(seen.toSorted()).toEqual([...new Set(seen)].toSorted());
  });

  it("names every action once", () => {
    const actions = KEY_BINDINGS.map((binding) => binding.action);
    expect(actions.length).toBe(new Set(actions).size);
  });
});

describe("matching a press to an action", () => {
  it("reads the platform's own modifier", () => {
    expect(actionFor(press("n", { metaKey: true }), "global", "apple")).toBe("new-session");
    expect(actionFor(press("n", { ctrlKey: true }), "global", "other")).toBe("new-session");
  });

  it("ignores the modifier the platform does not use", () => {
    expect(actionFor(press("n", { ctrlKey: true }), "global", "apple")).toBe(null);
    expect(actionFor(press("n", { metaKey: true }), "global", "other")).toBe(null);
  });

  it("keeps Escape in the composer apart from Escape outside it", () => {
    expect(actionFor(press("Escape", {}), "composer", "apple")).toBe("blur");
    expect(actionFor(press("Escape", {}), "global", "apple")).toBe("close-topmost");
  });

  it("separates the three Enter chords by their modifiers", () => {
    expect(actionFor(press("Enter", {}), "composer", "apple")).toBe("send");
    expect(actionFor(press("Enter", { shiftKey: true }), "composer", "apple")).toBe("newline");
    expect(actionFor(press("Enter", { metaKey: true }), "composer", "apple")).toBe(
      "send-and-draft",
    );
  });

  it("refuses a press that also holds Alt", () => {
    expect(actionFor(press("n", { metaKey: true, altKey: true }), "global", "apple")).toBe(null);
  });

  it("matches a letter whichever case the browser reports", () => {
    expect(actionFor(press("D", { metaKey: true, shiftKey: true }), "global", "apple")).toBe(
      "toggle-changes",
    );
  });
});

describe("naming a chord for the user", () => {
  it("writes the Mac glyphs without separators", () => {
    expect(chordName({ key: "d", mod: true, shift: true }, "apple")).toBe("⌘⇧D");
  });

  it("writes the other platforms' words with plus signs", () => {
    expect(chordName({ key: "d", mod: true, shift: true }, "other")).toBe("Ctrl+Shift+D");
  });

  it("leaves a named key as the browser writes it", () => {
    expect(chordName({ key: "Escape", mod: false, shift: false }, "other")).toBe("Escape");
  });
});
