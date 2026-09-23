import { describe, expect, it } from "vitest";

import { previewNote, sizeLabel } from "./file-preview";

describe("sizeLabel", () => {
  it("counts a small file in bytes", () => {
    expect(sizeLabel(1)).toBe("1 byte");
    expect(sizeLabel(900)).toBe("900 bytes");
  });

  it("rounds to kilobytes below a megabyte", () => {
    expect(sizeLabel(524_288)).toBe("512 KB");
  });

  it("gives megabytes to one decimal", () => {
    expect(sizeLabel(3_460_300)).toBe("3.3 MB");
  });
});

describe("previewNote", () => {
  it("says nothing over a text file, which shows itself", () => {
    expect(previewNote({ kind: "text", path: "models/orders.yaml", text: "name: orders\n" })).toBe(
      null,
    );
  });

  it("names a binary file's size and sends the reader to the editor", () => {
    expect(previewNote({ kind: "binary", path: "docs/diagram.png", bytes: 20_480 })).toBe(
      "docs/diagram.png is a binary file of 20 KB. Open it in your editor to see it.",
    );
  });

  it("names the size and the limit of a file too large to preview", () => {
    expect(
      previewNote({ kind: "too-large", path: "seed.sql", bytes: 3_460_300, limit: 524_288 }),
    ).toBe(
      "seed.sql is 3.3 MB, more than the 512 KB a preview reads. Open it in your editor to see it.",
    );
  });

  it("says a file that left the checkout is gone", () => {
    expect(previewNote({ kind: "gone", path: "models/orders.yaml" })).toBe(
      "models/orders.yaml is no longer in the checkout.",
    );
  });
});
