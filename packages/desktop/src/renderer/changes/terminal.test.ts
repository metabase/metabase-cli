import { describe, expect, it } from "vitest";

import { terminalText } from "./terminal";

describe("terminalText", () => {
  it("shows the last redraw of a progress line", () => {
    const raw =
      "Counting objects:  50% (1/2)\rCounting objects: 100% (2/2)\rCounting objects: 100% (2/2), done.\n";
    expect(terminalText(raw)).toBe("Counting objects: 100% (2/2), done.\n");
  });

  it("keeps a redraw that ends on a return, which git writes before the next one arrives", () => {
    expect(terminalText("Writing objects:  50% (1/2)\r")).toBe("Writing objects:  50% (1/2)");
  });

  it("leaves plain lines and blank lines as they are", () => {
    expect(terminalText("To /srv/remote.git\n\n * [new branch] rde/a -> rde/a\n")).toBe(
      "To /srv/remote.git\n\n * [new branch] rde/a -> rde/a\n",
    );
  });
});
