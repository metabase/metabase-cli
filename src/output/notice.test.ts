import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { itemOversizeMessage, listTruncationNotice, warn } from "./notice";

describe("warn", () => {
  let stderr: string;

  beforeEach(() => {
    stderr = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the message to stderr terminated with a single newline", () => {
    warn("storage unavailable; falling back to file");
    expect(stderr).toBe("storage unavailable; falling back to file\n");
  });
});

describe("listTruncationNotice", () => {
  it("formats the byte count and a recovery hint", () => {
    expect(listTruncationNotice(2048)).toBe("… cut at 2048 bytes; rerun with --max-bytes 0");
  });
});

describe("itemOversizeMessage", () => {
  it("names both the actual byte count and the configured cap alongside the knobs", () => {
    expect(itemOversizeMessage(4096, 1024)).toBe(
      "output is 4096 bytes, over the 1024-byte --max-bytes cap; narrow with --fields, or pass --max-bytes 0 to disable",
    );
  });
});
