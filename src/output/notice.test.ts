import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { itemOversizeNotice, listTruncationNotice, warn } from "./notice";

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

describe("itemOversizeNotice", () => {
  it("names the byte count and the available knobs", () => {
    expect(itemOversizeNotice(4096)).toBe(
      "… item is 4096 bytes (exceeds --max-bytes); narrow with --fields, or pass --max-bytes 0",
    );
  });
});
