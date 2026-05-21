import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import { parseJson } from "../../../runtime/json";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../../../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

import licenseStatusCommand, { LicenseStatus } from "./status";
import { writeLicense } from "../../../core/auth/storage";
import { setupTempConfigHome, type TempConfigHome } from "../../../core/auth/temp-config-home";

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

describe("license status command", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    home.cleanup();
  });

  it("emits present=false when no license", async () => {
    const capture = captureStdout();
    await runCommand(licenseStatusCommand, { rawArgs: ["--json"] });
    expect(capture.parse(LicenseStatus)).toEqual({ present: false });
  });

  it("emits present=true after license is set; never reveals the token", async () => {
    await writeLicense("very-secret-token-xyz");
    const capture = captureStdout();
    await runCommand(licenseStatusCommand, { rawArgs: ["--json"] });
    expect(capture.parse(LicenseStatus)).toEqual({ present: true });
    expect(capture.chunks.join("")).not.toContain("very-secret-token-xyz");
  });
});
