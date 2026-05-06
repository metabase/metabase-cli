import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mkSecureTempDir, removeTempDir, writeSecureFile } from "./tempdir";

describe("tempdir", () => {
  it("creates a directory we can write to and then remove", async () => {
    const dir = await mkSecureTempDir();
    try {
      const target = join(dir, "config.yml");
      await writeSecureFile(target, "version: 1\n");
      expect(await readFile(target, "utf8")).toBe("version: 1\n");
      // Files written via writeSecureFile must not be world-readable.
      const fileStat = await stat(target);
      expect(fileStat.mode & 0o077).toBe(0);
    } finally {
      await removeTempDir(dir);
    }
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removeTempDir is idempotent on a missing path", async () => {
    const dir = await mkSecureTempDir();
    await removeTempDir(dir);
    await removeTempDir(dir);
  });
});
