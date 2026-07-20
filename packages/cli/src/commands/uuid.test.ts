import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseJson } from "../runtime/json";

import uuidCommand, { MAX_COUNT, UuidList } from "./uuid";

type CaptureStream = "stdout" | "stderr";

async function captureFromRun(rawArgs: readonly string[], stream: CaptureStream): Promise<string> {
  const captured: string[] = [];
  const target = stream === "stdout" ? process.stdout : process.stderr;
  const spy = vi.spyOn(target, "write").mockImplementation((chunk) => {
    captured.push(String(chunk));
    return true;
  });
  try {
    await runCommand(uuidCommand, { rawArgs: [...rawArgs] });
  } finally {
    spy.mockRestore();
  }
  return captured.join("");
}

describe("uuid command", () => {
  const previousExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("--json --count 3 emits exactly 3 valid v4 UUIDs (all distinct)", async () => {
    const stdout = await captureFromRun(["--json", "--count", "3"], "stdout");
    const uuids = parseJson(stdout, UuidList);
    expect(uuids).toHaveLength(3);
    expect(new Set(uuids).size).toBe(3);
  });

  it("--json with no --count flag mints a single UUID (default count = 1)", async () => {
    const stdout = await captureFromRun(["--json"], "stdout");
    const uuids = parseJson(stdout, UuidList);
    expect(uuids).toHaveLength(1);
  });

  it("text mode emits one valid UUID per line and nothing else (suitable for xargs piping)", async () => {
    const stdout = await captureFromRun(["--format", "text", "--count", "2"], "stdout");
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    UuidList.parse(lines);
  });

  it("rejects --count 0 with ConfigError (exit code 2)", async () => {
    const stderr = await captureFromRun(["--count", "0", "--json"], "stderr");
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain("invalid --count: 0 (must be ≥ 1)");
  });

  it(`rejects --count above the ${MAX_COUNT} cap with ConfigError (exit code 2)`, async () => {
    const overCap = MAX_COUNT + 1;
    const stderr = await captureFromRun(["--count", String(overCap), "--json"], "stderr");
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain(`invalid --count: ${overCap} (must be ≤ ${MAX_COUNT})`);
  });
});
