import { afterEach, describe, expect, it } from "vitest";

import { parseJson } from "../../src/runtime/json";
import { UuidList } from "../../src/commands/uuid";

import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

describe("uuid e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("default invocation mints a single v4 UUID via JSON (subprocess stdout is non-TTY)", async () => {
    const result = await runCli({
      args: ["uuid"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const uuids = parseJson(result.stdout, UuidList);
    expect(uuids).toHaveLength(1);
  });

  it("--count 4 --json emits exactly 4 distinct v4 UUIDs", async () => {
    const result = await runCli({
      args: ["uuid", "--count", "4", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const uuids = parseJson(result.stdout, UuidList);
    expect(uuids).toHaveLength(4);
    expect(new Set(uuids).size).toBe(4);
  });

  it("--format text --count 3 prints one UUID per line and nothing else", async () => {
    const result = await runCli({
      args: ["uuid", "--format", "text", "--count", "3"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(3);
    UuidList.parse(lines);
  });

  it("--count 0 fails with ConfigError (exit 2) and the parse-integer message naming the flag", async () => {
    const result = await runCli({
      args: ["uuid", "--count", "0", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid --count: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });
});
