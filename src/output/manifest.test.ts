import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Manifest } from "../runtime/manifest";
import { parseJson } from "../runtime/json";

import { writeManifest } from "./manifest";

describe("writeManifest", () => {
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes pretty-printed JSON terminated by a single newline", () => {
    const manifest: Manifest = {
      version: 1,
      commands: [
        {
          command: "auth status",
          description: "show status",
          examples: [],
          args: [],
          outputSchema: null,
        },
      ],
    };

    writeManifest(manifest);
    const out = chunks.join("");
    expect(out.endsWith("\n")).toBe(true);
    expect(parseJson(out, Manifest)).toEqual(manifest);
  });
});
