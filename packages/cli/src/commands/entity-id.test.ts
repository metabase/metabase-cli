import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseJson } from "@metabase/client/json";

import entityIdCommand, {
  ENTITY_ID_ALPHABET,
  ENTITY_ID_LENGTH,
  EntityIdList,
  MAX_COUNT,
  mintEntityId,
} from "./entity-id";

type CaptureStream = "stdout" | "stderr";

async function captureFromRun(rawArgs: readonly string[], stream: CaptureStream): Promise<string> {
  const captured: string[] = [];
  const target = stream === "stdout" ? process.stdout : process.stderr;
  const spy = vi.spyOn(target, "write").mockImplementation((chunk) => {
    captured.push(String(chunk));
    return true;
  });
  try {
    await runCommand(entityIdCommand, { rawArgs: [...rawArgs] });
  } finally {
    spy.mockRestore();
  }
  return captured.join("");
}

describe("mintEntityId", () => {
  it("uses the 64-symbol NanoID alphabet, each symbol once", () => {
    expect(ENTITY_ID_ALPHABET).toHaveLength(64);
    expect(new Set(ENTITY_ID_ALPHABET).size).toBe(64);
    expect([...ENTITY_ID_ALPHABET].toSorted().join("")).toBe(
      "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz",
    );
  });

  it("mints 21 characters drawn from the alphabet", () => {
    for (let round = 0; round < 200; round += 1) {
      const id = mintEntityId();
      expect(id).toHaveLength(ENTITY_ID_LENGTH);
      expect([...id].every((symbol) => ENTITY_ID_ALPHABET.includes(symbol))).toBe(true);
    }
  });
});

describe("entity-id command", () => {
  const previousExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("--json --count 3 emits exactly 3 distinct ids", async () => {
    const stdout = await captureFromRun(["--json", "--count", "3"], "stdout");
    const ids = parseJson(stdout, EntityIdList);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("mints a single id without --count", async () => {
    const stdout = await captureFromRun(["--json"], "stdout");
    expect(parseJson(stdout, EntityIdList)).toHaveLength(1);
  });

  it("text mode emits one id per line and nothing else", async () => {
    const stdout = await captureFromRun(["--format", "text", "--count", "2"], "stdout");
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(EntityIdList.safeParse(lines).success).toBe(true);
  });

  it("rejects --count 0 with ConfigError (exit code 2)", async () => {
    const stderr = await captureFromRun(["--count", "0", "--json"], "stderr");
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain("invalid --count: 0 (must be ≥ 1)");
  });

  it(`rejects --count above the ${MAX_COUNT} cap with ConfigError (exit code 2)`, async () => {
    const stderr = await captureFromRun(["--count", String(MAX_COUNT + 1), "--json"], "stderr");
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain(`invalid --count: ${MAX_COUNT + 1} (must be ≤ ${MAX_COUNT})`);
  });
});
