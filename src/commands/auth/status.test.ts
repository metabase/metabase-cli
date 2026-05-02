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

import authStatusCommand, { AuthStatus } from "./status";
import { writeProfile } from "../../core/auth/storage";
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

describe("auth status command", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    home.cleanup();
  });

  it("emits JSON with present=false when no creds", async () => {
    const capture = captureStdout();
    await runCommand(authStatusCommand, { rawArgs: ["--profile", "default", "--json"] });
    expect(capture.parse(AuthStatus)).toEqual({
      profile: "default",
      present: false,
      url: null,
    });
  });

  it("emits JSON with present=true and sanitized URL when creds stored", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    const capture = captureStdout();
    await runCommand(authStatusCommand, { rawArgs: ["--profile", "default", "--json"] });
    expect(capture.parse(AuthStatus)).toEqual({
      profile: "default",
      present: true,
      url: "https://m.example.com",
    });
  });
});
