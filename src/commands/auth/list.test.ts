import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import { parseJson } from "../../runtime/json";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

import authListCommand, { AuthProfileListEnvelope } from "./list";
import { clearProfile, writeProfile } from "../../core/auth/storage";
import { setupTempConfigHome, type TempConfigHome } from "../../core/auth/temp-config-home";

interface CapturedStdout {
  chunks: string[];
  parse: <T>(schema: ZodType<T>) => T;
}

function captureStdout(): CapturedStdout {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    if (typeof chunk === "string") {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk).toString("utf8"));
    }
    return true;
  });
  return {
    chunks,
    parse: <T>(schema: ZodType<T>) => parseJson(chunks.join(""), schema, { source: "stdout" }),
  };
}

describe("auth list command", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    home.cleanup();
  });

  it("emits an empty envelope when no profiles are stored", async () => {
    const capture = captureStdout();
    await runCommand(authListCommand, { rawArgs: ["--json"] });
    expect(capture.parse(AuthProfileListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("lists every stored profile with sanitized URL and present=true", async () => {
    await writeProfile({ url: "https://staging.example.com/path?x=1", apiKey: "k1" }, "staging");
    await writeProfile({ url: "https://prod.example.com", apiKey: "k2" }, "prod");

    const capture = captureStdout();
    await runCommand(authListCommand, { rawArgs: ["--json"] });
    expect(capture.parse(AuthProfileListEnvelope)).toEqual({
      data: [
        { profile: "prod", url: "https://prod.example.com", present: true },
        { profile: "staging", url: "https://staging.example.com", present: true },
      ],
      returned: 2,
      total: 2,
    });
  });

  it("drops a profile from the list after clearProfile", async () => {
    await writeProfile({ url: "https://a.example.com", apiKey: "a" }, "a");
    await writeProfile({ url: "https://b.example.com", apiKey: "b" }, "b");
    await clearProfile("a");

    const capture = captureStdout();
    await runCommand(authListCommand, { rawArgs: ["--json"] });
    expect(capture.parse(AuthProfileListEnvelope)).toEqual({
      data: [{ profile: "b", url: "https://b.example.com", present: true }],
      returned: 1,
      total: 1,
    });
  });
});
