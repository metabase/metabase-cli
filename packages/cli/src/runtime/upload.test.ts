import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";

import { buildCsvFormData, readCsvFile, requireUploadFilePath } from "./upload";

describe("requireUploadFilePath", () => {
  it("returns the path when present", () => {
    expect(requireUploadFilePath("data.csv")).toBe("data.csv");
  });

  it("rejects a missing or blank path with ConfigError", () => {
    expect(() => requireUploadFilePath(undefined)).toThrow(ConfigError);
    expect(() => requireUploadFilePath("   ")).toThrow(
      "provide the CSV file to upload with --file <path>",
    );
  });
});

describe("readCsvFile", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempFile(name: string, content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "mb-upload-"));
    dirs.push(dir);
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  }

  it("reads the raw bytes and derives the filename from the path", async () => {
    const path = await tempFile("people.csv", "id,name\n1,alice\n");
    const file = await readCsvFile(path);
    expect({ filename: file.filename, text: Buffer.from(file.bytes).toString("utf8") }).toEqual({
      filename: "people.csv",
      text: "id,name\n1,alice\n",
    });
  });

  it("maps a missing file to a ConfigError", async () => {
    const path = join(tmpdir(), "mb-upload-does-not-exist.csv");
    await expect(readCsvFile(path)).rejects.toThrow(ConfigError);
    await expect(readCsvFile(path)).rejects.toThrow(`--file not found: ${path}`);
  });
});

describe("buildCsvFormData", () => {
  it("attaches the bytes under the file field with the given filename", () => {
    const form = buildCsvFormData({ filename: "x.csv", bytes: new Uint8Array([104, 105]) });
    const entry = form.get("file");
    if (!(entry instanceof File)) {
      throw new Error("expected a File part under 'file'");
    }
    expect({ name: entry.name, size: entry.size, type: entry.type }).toEqual({
      name: "x.csv",
      size: 2,
      type: "text/csv",
    });
  });
});
