import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import type { Credential } from "../../core/auth/credential";
import { parseJson } from "../../runtime/json";
import type { Verification } from "../../core/auth/verify";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
  verify: { results: new Map<string, Verification>() },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

vi.mock("../../core/auth/verify", () => ({
  verifyAndProbe: async (url: string, credential: Credential): Promise<Verification> => {
    const key = credential.kind === "apiKey" ? credential.apiKey : credential.accessToken;
    const result = hoisted.verify.results.get(key);
    if (result === undefined) {
      throw new Error(`no verifyAndProbe result configured for credential "${key}"`);
    }
    return result;
  },
}));

import authListCommand, { AuthProfileListEnvelope } from "./list";
import { writeProfile, readProfileRecord } from "../../core/auth/storage";
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

function captureStderr(): string[] {
  const captured: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    captured.push(String(chunk));
    return true;
  });
  return captured;
}

function successVerify(): Verification {
  return {
    ok: true,
    user: { id: 1, name: "Tester", isAdmin: true },
    server: {
      version: { tag: "v0.58.7", major: 58, patch: 7 },
      tokenFeatures: null,
    },
  };
}

describe("auth list command", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.verify.results.clear();
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

  it("probes each stored profile and writes the refreshed lastProbe to disk", async () => {
    hoisted.verify.results.set("k1", successVerify());
    hoisted.verify.results.set("k2", successVerify());
    await writeProfile({ url: "https://staging.example.com/path?x=1", apiKey: "k1" }, "staging");
    await writeProfile({ url: "https://prod.example.com", apiKey: "k2" }, "prod");

    const capture = captureStdout();
    await runCommand(authListCommand, { rawArgs: ["--json"] });

    const envelope = capture.parse(AuthProfileListEnvelope);
    expect(envelope.returned).toBe(2);
    expect(envelope.data.map((entry) => entry.profile)).toEqual(["staging", "prod"]);
    expect(envelope.data.every((entry) => entry.status === "ok")).toBe(true);
    // The subpath survives (instances hosted under a path stay distinguishable); query is dropped.
    expect(envelope.data[0]?.url).toBe("https://staging.example.com/path");
    expect(envelope.data[0]?.version).toEqual({
      tag: "v0.58.7",
      major: 58,
      patch: 7,
    });
    expect(envelope.data[0]?.user).toEqual({ id: 1, name: "Tester", isAdmin: true });

    const staging = await readProfileRecord("staging");
    expect(staging?.lastProbe?.version?.tag).toBe("v0.58.7");
    expect(staging?.lastFailure).toBeNull();
  });

  it("renders Auth failed status, footer line, and persists lastFailure on a 401 response", async () => {
    hoisted.verify.results.set("revoked", {
      ok: false,
      which: "user",
      kind: "auth",
      status: 401,
      message: "Invalid or unauthorized API key",
    });
    await writeProfile({ url: "https://m.example.com", apiKey: "revoked" }, "revoked_profile");

    const capture = captureStdout();
    const stderr = captureStderr();
    await runCommand(authListCommand, { rawArgs: ["--json"] });

    const envelope = capture.parse(AuthProfileListEnvelope);
    expect(envelope.data).toHaveLength(1);
    const record = await readProfileRecord("revoked_profile");
    expect(envelope.data[0]?.status).toBe("auth-failed");
    expect(envelope.data[0]?.lastFailure).toEqual(record?.lastFailure);
    expect(record?.lastFailure).toEqual({
      at: envelope.data[0]?.lastFailure?.at,
      kind: "auth",
      reason: "Invalid or unauthorized API key",
    });

    expect(stderr.join("")).toContain(
      "revoked_profile: Invalid or unauthorized API key. Run `mb auth login --profile revoked_profile` to update the token.",
    );
  });

  it("preserves the previous lastProbe and apiKey on a failed refresh", async () => {
    hoisted.verify.results.set("good", successVerify());
    await writeProfile({ url: "https://m.example.com", apiKey: "good" }, "stable");

    await runCommand(authListCommand, { rawArgs: ["--json"] });
    const before = await readProfileRecord("stable");
    expect(before?.lastProbe).not.toBeNull();

    hoisted.verify.results.set("good", {
      ok: false,
      which: "server",
      kind: "network",
      message: "Could not reach Metabase: getaddrinfo ENOTFOUND",
    });
    await runCommand(authListCommand, { rawArgs: ["--json"] });
    const after = await readProfileRecord("stable");

    expect(after?.lastProbe).toEqual(before?.lastProbe);
    expect(after?.url).toBe(before?.url);
    expect(after?.apiKey).toBe(before?.apiKey);
    expect(after?.lastFailure?.kind).toBe("network");
  });
});
