import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("merging classes over the type scale", () => {
  it("keeps a size beside a colour when classes merge", () => {
    expect(cn("text-meta text-ink-3")).toBe("text-meta text-ink-3");
  });

  it("lets a later size replace an earlier one", () => {
    expect(cn("text-body", "text-meta")).toBe("text-meta");
  });
});
