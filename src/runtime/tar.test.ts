import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runProcess } from "./process";
import { buildTar } from "./tar";

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
