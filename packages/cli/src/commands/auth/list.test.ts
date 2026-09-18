import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z, ZodType } from "zod";

import type { Credential } from "@metabase/client/auth/credential";
import { parseJson } from "@metabase/client/json";
import type { ServerInfo } from "@metabase/client/version/probe";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";
import { createServerProfile } from "@metabase/client/version/profile";
import type { ProfileRecord } from "../../core/auth/profile-record";
import type { Verification } from "../../core/auth/verify";

const hoisted = vi.hoisted(() => {
  const probed: string[] = [];
  return {
    store: new Map<string, string>(),
    controls: { broken: false },
    verify: { results: new Map<string, Verification>(), probed },
  };
});

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

vi.mock("../../core/auth/verify", () => ({
  verifyAndProbe: async (url: string, credential: Credential): Promise<Verification> => {
    const key = credential.kind === "apiKey" ? credential.apiKey : credential.accessToken;
    hoisted.verify.probed.push(key);
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

type AuthProfileEntry = z.infer<typeof AuthProfileListEnvelope>["data"][number];

const PROBED_AT = "2026-03-04T05:06:07.000Z";
const LATER = "2026-03-04T06:00:00.000Z";

function successServer(): ServerInfo {
  return {
    edition: "oss",
    version: { tag: "v0.58.7", major: 58, patch: 7 },
    date: null,
    hash: null,
    tokenFeatures: null,
  };
}

function successVerify(): Verification {
  return {
    ok: true,
    user: { id: 1, name: "Tester", isAdmin: true },
    server: successServer(),
  };
}

function okEntry(profile: string, url: string): AuthProfileEntry {
  return {
    profile,
    url,
    method: "apiKey",
    authenticated: true,
    status: "ok",
    user: { id: 1, name: "Tester", isAdmin: true },
    version: { tag: "v0.58.7", major: 58, patch: 7 },
    edition: "oss",
    skew: "supported",
    knownRange: KNOWN_RANGE,
    tokenFeatures: null,
    features: createServerProfile(successServer()).features,
    lastProbedAt: PROBED_AT,
    lastFailure: null,
  };
}

function probedRecord(name: string, url: string): ProfileRecord {
  return {
    name,
    url,
    apiKey: null,
    oauth: null,
    lastProbe: {
      at: PROBED_AT,
      edition: "oss",
      version: { tag: "v0.58.7", major: 58, patch: 7 },
      date: null,
      hash: null,
      tokenFeatures: null,
      user: { id: 1, name: "Tester", isAdmin: true },
    },
    lastFailure: null,
  };
}

describe("auth list command", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.verify.results.clear();
    hoisted.verify.probed.length = 0;
    home = setupTempConfigHome();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PROBED_AT));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    home.cleanup();
  });

  it("emits an empty envelope when no profiles are stored", async () => {
    const capture = captureStdout();
    await runCommand(authListCommand, { rawArgs: ["--json"] });
    expect(capture.parse(AuthProfileListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("probes each stored profile and writes the refreshed lastProbe to disk", async () => {
    hoisted.verify.results.set("k1", successVerify());
    hoisted.verify.results.set("k2", successVerify());
    await writeProfile({ url: "https://staging.example.com/path?x=1", apiKey: "k1" }, "staging");
    await writeProfile({ url: "https://prod.example.com", apiKey: "k2" }, "prod");

    const capture = captureStdout();
    await runCommand(authListCommand, { rawArgs: ["--json"] });

    // The subpath survives (instances hosted under a path stay distinguishable); query is dropped.
    expect(capture.parse(AuthProfileListEnvelope)).toEqual({
      data: [
        okEntry("staging", "https://staging.example.com/path"),
        okEntry("prod", "https://prod.example.com"),
      ],
      returned: 2,
      offset: 0,
      total: 2,
      has_more: false,
      next_offset: null,
    });
    expect(await readProfileRecord("staging")).toEqual(
      probedRecord("staging", "https://staging.example.com/path?x=1"),
    );
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

    const failure = { at: PROBED_AT, kind: "auth", reason: "Invalid or unauthorized API key" };
    expect(capture.parse(AuthProfileListEnvelope).data).toEqual([
      {
        profile: "revoked_profile",
        url: "https://m.example.com",
        method: "apiKey",
        authenticated: false,
        status: "auth-failed",
        user: null,
        version: null,
        edition: null,
        skew: null,
        knownRange: KNOWN_RANGE,
        tokenFeatures: null,
        features: null,
        lastProbedAt: null,
        lastFailure: failure,
      },
    ]);
    expect(await readProfileRecord("revoked_profile")).toEqual({
      name: "revoked_profile",
      url: "https://m.example.com",
      apiKey: null,
      oauth: null,
      lastProbe: null,
      lastFailure: failure,
    });

    expect(stderr.join("")).toContain(
      "revoked_profile: Invalid or unauthorized API key. Run `mb auth login --profile revoked_profile` to update the token.",
    );
  });

  it("probes only the profiles the window displays", async () => {
    hoisted.verify.results.set("k1", successVerify());
    hoisted.verify.results.set("k2", successVerify());
    await writeProfile({ url: "https://staging.example.com", apiKey: "k1" }, "staging");
    await writeProfile({ url: "https://prod.example.com", apiKey: "k2" }, "prod");

    captureStdout();
    await runCommand(authListCommand, { rawArgs: ["--json", "--limit", "1"] });

    expect(hoisted.verify.probed).toEqual(["k1"]);
  });

  it("warns only about the profiles the window displays", async () => {
    hoisted.verify.results.set("good", successVerify());
    hoisted.verify.results.set("revoked", {
      ok: false,
      which: "user",
      kind: "auth",
      status: 401,
      message: "Invalid or unauthorized API key",
    });
    await writeProfile({ url: "https://shown.example.com", apiKey: "good" }, "shown");
    await writeProfile({ url: "https://unseen.example.com", apiKey: "revoked" }, "unseen");

    captureStdout();
    const stderr = captureStderr();
    await runCommand(authListCommand, { rawArgs: ["--json", "--limit", "1"] });

    expect(stderr.join("")).toBe("");
  });

  it("counts every stored profile in the envelope even though it probed one", async () => {
    hoisted.verify.results.set("k1", successVerify());
    hoisted.verify.results.set("k2", successVerify());
    await writeProfile({ url: "https://staging.example.com", apiKey: "k1" }, "staging");
    await writeProfile({ url: "https://prod.example.com", apiKey: "k2" }, "prod");

    const capture = captureStdout();
    await runCommand(authListCommand, { rawArgs: ["--json", "--limit", "1"] });

    expect(capture.parse(AuthProfileListEnvelope)).toEqual({
      data: [okEntry("staging", "https://staging.example.com")],
      returned: 1,
      offset: 0,
      limit: 1,
      total: 2,
      has_more: true,
      next_offset: 1,
    });
  });

  it("preserves the previous lastProbe and apiKey on a failed refresh", async () => {
    captureStdout();
    hoisted.verify.results.set("good", successVerify());
    await writeProfile({ url: "https://m.example.com", apiKey: "good" }, "stable");

    await runCommand(authListCommand, { rawArgs: ["--json"] });
    expect(await readProfileRecord("stable")).toEqual(
      probedRecord("stable", "https://m.example.com"),
    );

    vi.setSystemTime(new Date(LATER));
    hoisted.verify.results.set("good", {
      ok: false,
      which: "server",
      kind: "network",
      message: "Could not reach Metabase: getaddrinfo ENOTFOUND",
    });
    await runCommand(authListCommand, { rawArgs: ["--json"] });

    expect(await readProfileRecord("stable")).toEqual({
      ...probedRecord("stable", "https://m.example.com"),
      lastFailure: {
        at: LATER,
        kind: "network",
        reason: "Could not reach Metabase: getaddrinfo ENOTFOUND",
      },
    });
    expect(hoisted.store.get("metabase-cli:profile:stable:apiKey")).toBe("good");
  });
});
