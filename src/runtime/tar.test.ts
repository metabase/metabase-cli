import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runProcess } from "./process";
import { buildTar, extractSingleFileFromTar, TarParseError } from "./tar";

async function extractWithSystemTar(archive: Uint8Array, dest: string): Promise<void> {
  const result = await runProcess("tar", ["-xf", "-", "-C", dest], { stdin: archive });
  expect(result.exitCode, result.stderr).toBe(0);
}

describe("buildTar", () => {
  it("produces a ustar archive that the system tar binary can extract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tar-test-"));
    try {
      const archive = buildTar([
        { type: "directory", name: "mw-config", mode: 0o755 },
        { type: "file", name: "mw-config/config.yml", content: "version: 1\n", mode: 0o600 },
        { type: "file", name: "mw-config/metadata.json", content: "{}\n", mode: 0o600 },
      ]);

      await extractWithSystemTar(archive, dir);

      expect(await readFile(join(dir, "mw-config/config.yml"), "utf8")).toBe("version: 1\n");
      expect(await readFile(join(dir, "mw-config/metadata.json"), "utf8")).toBe("{}\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves binary content byte-for-byte", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tar-test-"));
    try {
      const payload = new Uint8Array(1024);
      for (let i = 0; i < payload.length; i++) {
        payload[i] = i & 0xff;
      }
      const archive = buildTar([{ type: "file", name: "blob.bin", content: payload }]);

      await extractWithSystemTar(archive, dir);

      const extracted = await readFile(join(dir, "blob.bin"));
      expect(new Uint8Array(extracted)).toEqual(payload);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("extractSingleFileFromTar", () => {
  it("round-trips ASCII content through buildTar + extract", () => {
    const archive = buildTar([{ type: "file", name: "credentials.json", content: '{"x":1}\n' }]);
    const extracted = extractSingleFileFromTar(archive, "credentials.json");
    expect(new TextDecoder().decode(extracted)).toBe('{"x":1}\n');
  });

  it("round-trips binary content byte-for-byte", () => {
    const payload = new Uint8Array(600);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = (i * 7) & 0xff;
    }
    const archive = buildTar([{ type: "file", name: "blob.bin", content: payload }]);
    const extracted = extractSingleFileFromTar(archive, "blob.bin");
    expect(extracted).toEqual(payload);
  });

  it("matches by name suffix to tolerate docker cp's directory prefix", () => {
    const archive = buildTar([{ type: "file", name: "mw-config/credentials.json", content: "ok" }]);
    const extracted = extractSingleFileFromTar(archive, "credentials.json");
    expect(new TextDecoder().decode(extracted)).toBe("ok");
  });

  it("throws when the entry name does not match", () => {
    const archive = buildTar([{ type: "file", name: "other.json", content: "ok" }]);
    expect(() => extractSingleFileFromTar(archive, "credentials.json")).toThrow(TarParseError);
    expect(() => extractSingleFileFromTar(archive, "credentials.json")).toThrow(
      'unexpected tar entry "other.json", expected to end with "credentials.json"',
    );
  });

  it("throws when the buffer is shorter than one block", () => {
    expect(() => extractSingleFileFromTar(new Uint8Array(100), "any")).toThrow(TarParseError);
    expect(() => extractSingleFileFromTar(new Uint8Array(100), "any")).toThrow(
      "tar is shorter than one block: 100 bytes",
    );
  });
});
