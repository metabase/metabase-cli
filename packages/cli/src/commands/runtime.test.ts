import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";
import { captureFetch, jsonResponse } from "@metabase/client/testing/fetch-capture";
import type { ServerInfo } from "@metabase/client/version/probe";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";
import { createServerProfile } from "@metabase/client/version/profile";

import type { ProfileLastProbe, ProfileRecord } from "../core/auth/profile-record";
import { probeAt, setupTempConfigHome, type TempConfigHome } from "../core/auth/temp-config-home";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

const { defineMetabaseCommand, SKIP_PREFLIGHT_ENV } = await import("./runtime");
const { connectionFlags, listFlags, outputFlags, profileFlag } = await import("./flags");
const { readProfileRecord, writeProbeResult, writeProfile } = await import("../core/auth/storage");

const BEYOND_KNOWN = KNOWN_RANGE.max + 5;
const PROBED_AT = "2026-03-04T05:06:07.000Z";
const REPROBED_AT = "2026-03-04T06:00:00.000Z";

const NEWER_NOTICE = `Metabase v0.${BEYOND_KNOWN}.0 is newer than this CLI supports (up to v${KNOWN_RANGE.max}); commands run as if it were a head build past v${KNOWN_RANGE.max}. Run \`mb upgrade\` for a newer CLI.\n`;
const UNKNOWN_NOTICE = `Could not parse the Metabase version; assuming a head build past v${KNOWN_RANGE.max}.\n`;

function shapeErrorEnvelope(message: string): unknown {
  return { ok: false, error: { category: "response-shape", message, exitCode: 1 } };
}

function capabilityErrorEnvelope(message: string): unknown {
  return { ok: false, error: { category: "capability", message, exitCode: 2 } };
}

function errorEnvelopeOf(stderr: string[]): unknown {
  return parseJson(stderr.join(""), z.unknown(), { source: "stderr" });
}

async function seedProbedProfile(name: string, info: ServerInfo): Promise<void> {
  await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" }, name);
  await writeProbeResult(name, {
    user: { id: 1, name: "Tester", isAdmin: true },
    server: info,
  });
}

function reprobedRecord(probe: ProfileLastProbe): ProfileRecord {
  return {
    name: "default",
    url: "https://m.example.com",
    apiKey: null,
    oauth: null,
    lastProbe: { ...probe, at: REPROBED_AT, user: { id: 1, name: "Tester", isAdmin: true } },
    lastFailure: null,
  };
}

function sameServerProbe(major: number): Response {
  return jsonResponse({ version: { tag: `v0.${major}.0` }, "token-features": {} });
}

function captureStderr(): string[] {
  const captured: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    captured.push(String(chunk));
    return true;
  });
  return captured;
}

describe("defineMetabaseCommand", () => {
  let home: TempConfigHome;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
    for (const name of ["URL", "API_KEY", "PROFILE"]) {
      delete process.env[`MB_${name}`];
      delete process.env[`METABASE_${name}`];
    }
    delete process.env[SKIP_PREFLIGHT_ENV];
    previousExitCode = process.exitCode;
    process.exitCode = 0;
    vi.stubGlobal("fetch", captureFetch([]).fetch);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PROBED_AT));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    home.cleanup();
    delete process.env[SKIP_PREFLIGHT_ENV];
    process.exitCode = previousExitCode;
  });

  it("resolves opted-in output flags into ctx and exposes custom flags on args", async () => {
    const observed = vi.fn<(format: string, custom: string | undefined) => void>();

    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo" },
      requires: [],
      args: { ...outputFlags, custom: { type: "string", description: "custom flag" } },
      run({ args, ctx }) {
        observed(ctx.format, args.custom);
      },
    });

    await runCommand(cmd, { rawArgs: ["--json", "--custom", "x"] });
    expect(observed).toHaveBeenCalledWith("json", "x");
  });

  it("leaves profile/url/apiKey undefined when the command opts into no flag groups", async () => {
    const observed = vi.fn<(profile: string | undefined, url: string | undefined) => void>();
    const cmd = defineMetabaseCommand({
      meta: { name: "bare", description: "no opt-ins" },
      requires: [],
      args: {},
      run({ ctx }) {
        observed(ctx.profile, ctx.url);
      },
    });

    await runCommand(cmd, { rawArgs: [] });
    expect(observed).toHaveBeenCalledWith(undefined, undefined);
  });

  it("resolves config and creates a client lazily on getClient()", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });

    const observed = vi.fn<(client: unknown) => void>();
    const cmd = defineMetabaseCommand({
      meta: { name: "uses-client", description: "uses the client" },
      requires: [],
      args: { ...profileFlag },
      async run({ getClient }) {
        const client = await getClient();
        observed(client);
      },
    });

    await runCommand(cmd, { rawArgs: ["--profile", "default"] });
    expect(observed).toHaveBeenCalledOnce();
  });

  it("does not call resolveConfig when the run handler never calls getClient", async () => {
    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "no-client", description: "does not need the client" },
      requires: [],
      args: {},
      run() {
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(ran).toHaveBeenCalledOnce();
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(0);
  });

  it("returns the same client instance across multiple getClient() calls", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    let first: unknown;
    let second: unknown;
    const cmd = defineMetabaseCommand({
      meta: { name: "cached", description: "client is cached" },
      requires: [],
      args: {},
      async run({ getClient }) {
        first = await getClient();
        second = await getClient();
      },
    });
    await runCommand(cmd, { rawArgs: [] });
    expect(first).toBe(second);
  });

  it("reports ConfigError as a JSON error envelope to stderr (non-TTY format) and sets exitCode 2", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-creds", description: "needs creds" },
      requires: [],
      args: {},
      async run({ getClient }) {
        await getClient();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    const parsed = errorEnvelopeOf(stderr);
    expect(parsed).toEqual({
      ok: false,
      error: {
        category: "config",
        message:
          'Not authenticated for profile "default". Run `mb auth login`, set MB_URL/MB_API_KEY, or pass --url/--api-key.',
        exitCode: 2,
      },
    });
    expect(process.exitCode).toBe(2);
  });

  it("reports a rejected --limit as a JSON error envelope and never runs the command", async () => {
    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "ranged", description: "takes a range" },
      requires: [],
      args: { ...outputFlags, ...listFlags },
      run() {
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: ["--json", "--limit", "0"] });

    const parsed = errorEnvelopeOf(stderr);
    expect(parsed).toEqual({
      ok: false,
      error: {
        category: "config",
        message: "invalid --limit: 0 (must be ≥ 1)",
        exitCode: 2,
      },
    });
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("reports a rejected --max-bytes as a JSON error envelope", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "capped", description: "takes a cap" },
      requires: [],
      args: { ...outputFlags },
      run() {
        return;
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: ["--json", "--max-bytes", "abc"] });

    const parsed = errorEnvelopeOf(stderr);
    expect(parsed).toEqual({
      ok: false,
      error: {
        category: "config",
        message: 'invalid --max-bytes: "abc" (expected integer)',
        exitCode: 2,
      },
    });
    expect(process.exitCode).toBe(2);
  });

  it("reports an unresolvable --format as plain text", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "misformatted", description: "bad format" },
      requires: [],
      args: { ...outputFlags },
      run() {
        return;
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: ["--format", "bogus"] });

    expect(stderr.join("")).toBe('invalid --format value: "bogus" (expected: auto, json, text)\n');
    expect(process.exitCode).toBe(2);
  });

  it("refuses with CapabilityError exit code 2 before run does any work when the cached server lacks a required feature", async () => {
    await seedProbedProfile("default", probeAt(58));
    vi.stubGlobal("fetch", captureFetch([sameServerProbe(58)]).fetch);

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-activation", description: "wants job activation" },
      args: {},
      requires: ["transformJob.setActive"],
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain(
      "This operation requires Metabase v61+ (this server is v0.58.0). Upgrade Metabase to use it.",
    );
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("refuses with CapabilityError exit code 2 when the required premium token-feature is absent", async () => {
    await seedProbedProfile("default", probeAt(61));
    vi.stubGlobal("fetch", captureFetch([sameServerProbe(61)]).fetch);

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-library", description: "wants the library" },
      args: {},
      requires: ["library.get"],
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain(
      "This operation requires the 'library' premium feature (not enabled on this server).",
    );
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("refuses on a second declared method's feature when the first is satisfied", async () => {
    await seedProbedProfile("default", probeAt(59));
    vi.stubGlobal("fetch", captureFetch([sameServerProbe(59)]).fetch);

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "two-methods", description: "calls two gated methods" },
      args: {},
      requires: ["measure.list", "transformJob.setActive"],
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain(
      "This operation requires Metabase v61+ (this server is v0.59.0). Upgrade Metabase to use it.",
    );
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("never asks the client for a profile when every declared method is baseline", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    const capture = captureFetch([]);
    vi.stubGlobal("fetch", capture.fetch);

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "baseline-only", description: "baseline methods only" },
      requires: ["card.list", "user.current"],
      args: {},
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(ran).toHaveBeenCalledOnce();
    expect(capture.calls).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("never asks the client for a profile when the command declares no methods at all", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    const capture = captureFetch([]);
    vi.stubGlobal("fetch", capture.fetch);

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "no-methods", description: "declares nothing" },
      requires: [],
      args: {},
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(ran).toHaveBeenCalledOnce();
    expect(capture.calls).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("never asks the client for a profile when the command declares it reaches no server", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    const capture = captureFetch([]);
    vi.stubGlobal("fetch", capture.fetch);

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "offline", description: "reaches no server" },
      requires: null,
      args: {},
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(ran).toHaveBeenCalledOnce();
    expect(capture.calls).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("hands the client the cached probe's profile and never probes", async () => {
    const info = probeAt(61);
    await seedProbedProfile("default", info);

    const seen = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "reads-profile", description: "reads the server profile" },
      args: {},
      requires: [],
      async run({ getClient }) {
        const client = await getClient();
        seen(await client.server());
      },
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(seen.mock.calls).toEqual([[createServerProfile(info)]]);
  });

  it("probes the server once when the profile has no cached probe and refuses on what it learns", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    const capture = captureFetch([
      jsonResponse({ version: { tag: "v0.58.0" }, "token-features": {} }),
    ]);
    vi.stubGlobal("fetch", capture.fetch);

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "probes-lazily", description: "wants measures" },
      args: {},
      requires: ["measure.list"],
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://m.example.com/api/session/properties",
    ]);
    expect(stderr.join("")).toContain(
      "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
    );
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("ends the command with the probe's own error when there is no cached probe and the server cannot be reached", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    const capture = captureFetch([new TypeError("fetch failed")]);
    vi.stubGlobal("fetch", capture.fetch);

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "probe-fails", description: "wants measures" },
      args: {},
      requires: ["measure.list"],
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toBe(
      JSON.stringify({
        ok: false,
        error: {
          category: "network",
          message: "Could not reach Metabase: fetch failed",
          exitCode: 1,
        },
      }) + "\n",
    );
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://m.example.com/api/session/properties",
    ]);
    expect(ran).not.toHaveBeenCalled();
  });

  it("reads an unparseable cached version as the newest known, says so once, and proceeds", async () => {
    await seedProbedProfile("default", {
      edition: null,
      version: null,
      date: null,
      hash: null,
      tokenFeatures: null,
    });

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-activation-unknown", description: "wants job activation" },
      args: {},
      requires: ["transformJob.setActive"],
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toBe(UNKNOWN_NOTICE);
    expect(ran).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(0);
  });

  it("prints one newer-server notice when the cached probe is above the known range, even for a baseline command", async () => {
    await seedProbedProfile("default", probeAt(BEYOND_KNOWN));

    const cmd = defineMetabaseCommand({
      meta: { name: "baseline-on-newer", description: "baseline on a newer server" },
      args: {},
      requires: ["card.list"],
      async run({ getClient }) {
        await getClient();
        await getClient();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toBe(NEWER_NOTICE);
    expect(process.exitCode).toBe(0);
  });

  it("prints no notice when the cached probe is inside the known range", async () => {
    await seedProbedProfile("default", probeAt(KNOWN_RANGE.max));

    const cmd = defineMetabaseCommand({
      meta: { name: "supported", description: "supported server" },
      args: {},
      requires: ["measure.list"],
      async run({ getClient }) {
        await getClient();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toBe("");
  });

  it("prints the newer-server notice off the live probe when a gated command runs without a cached probe", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    const capture = captureFetch([
      jsonResponse({ version: { tag: `v0.${BEYOND_KNOWN}.0` }, "token-features": {} }),
      jsonResponse([]),
    ]);
    vi.stubGlobal("fetch", capture.fetch);

    const cmd = defineMetabaseCommand({
      meta: { name: "probes-newer", description: "wants measures on a newer server" },
      args: {},
      requires: ["measure.list"],
      async run({ getClient }) {
        const client = await getClient();
        await client.measure.list();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toBe(NEWER_NOTICE);
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://m.example.com/api/session/properties",
      "https://m.example.com/api/measure",
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("ignores the cached probe when --url points the profile at another server", async () => {
    await seedProbedProfile("default", probeAt(58));
    const capture = captureFetch([
      jsonResponse({ version: { tag: "v0.61.0" }, "token-features": {} }),
      jsonResponse([]),
    ]);
    vi.stubGlobal("fetch", capture.fetch);

    const seen = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "other-url", description: "same profile, other server" },
      args: { ...connectionFlags },
      requires: ["measure.list"],
      async run({ getClient }) {
        const client = await getClient();
        seen(await client.measure.list());
      },
    });

    await runCommand(cmd, { rawArgs: ["--url", "https://other.example.com"] });

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://other.example.com/api/session/properties",
      "https://other.example.com/api/measure",
    ]);
    expect(seen.mock.calls).toEqual([[{ data: [], total: null }]]);
  });

  describe("re-probe on a shape error", () => {
    const SHAPE_LEAD =
      "On Metabase v0.59.0 the response shape was unexpected:\n" +
      "  Invalid input: expected array, received object";

    function measureListCommand() {
      return defineMetabaseCommand({
        meta: { name: "lists-measures", description: "lists measures" },
        args: {},
        requires: ["measure.list"],
        async run({ getClient }) {
          const client = await getClient();
          await client.measure.list();
        },
      });
    }

    it("re-probes once, writes a changed server back to the profile, and appends the change to the error", async () => {
      await seedProbedProfile("default", probeAt(59));
      vi.setSystemTime(new Date(REPROBED_AT));
      const capture = captureFetch([
        jsonResponse({}),
        jsonResponse({
          version: { tag: "v0.63.4", date: "2026-09-01", hash: "abc1234" },
          "token-features": { library: true },
        }),
      ]);
      vi.stubGlobal("fetch", capture.fetch);
      const stderr = captureStderr();

      await runCommand(measureListCommand(), { rawArgs: [] });

      expect(capture.calls.map((call) => call.url)).toEqual([
        "https://m.example.com/api/measure",
        "https://m.example.com/api/session/properties",
      ]);
      expect(errorEnvelopeOf(stderr)).toEqual(
        shapeErrorEnvelope(
          `${SHAPE_LEAD}\nThe server's version changed since the last probe (was v0.59.0, now v0.63.4); the profile was refreshed — retry the command.`,
        ),
      );
      expect(process.exitCode).toBe(1);
      expect(await readProfileRecord("default")).toEqual(
        reprobedRecord({
          at: REPROBED_AT,
          edition: "oss",
          version: { tag: "v0.63.4", major: 63, patch: 4 },
          date: "2026-09-01",
          hash: "abc1234",
          tokenFeatures: { library: true },
          user: { id: 1, name: "Tester", isAdmin: true },
        }),
      );
    });

    it("names changed premium features when the version is the same", async () => {
      await seedProbedProfile("default", {
        ...probeAt(59),
        tokenFeatures: { library: false },
      });
      vi.setSystemTime(new Date(REPROBED_AT));
      const capture = captureFetch([
        jsonResponse({}),
        jsonResponse({ version: { tag: "v0.59.0" }, "token-features": { library: true } }),
      ]);
      vi.stubGlobal("fetch", capture.fetch);
      const stderr = captureStderr();

      await runCommand(measureListCommand(), { rawArgs: [] });

      expect(errorEnvelopeOf(stderr)).toEqual(
        shapeErrorEnvelope(
          `${SHAPE_LEAD}\nThe server's premium features changed since the last probe; the profile was refreshed — retry the command.`,
        ),
      );
      expect(await readProfileRecord("default")).toEqual(
        reprobedRecord({
          at: REPROBED_AT,
          edition: "oss",
          version: { tag: "v0.59.0", major: 59, patch: 0 },
          date: null,
          hash: null,
          tokenFeatures: { library: true },
          user: { id: 1, name: "Tester", isAdmin: true },
        }),
      );
    });

    it("reports the error unchanged and leaves the profile alone when the fresh probe agrees with the cache", async () => {
      await seedProbedProfile("default", probeAt(59));
      const before = await readProfileRecord("default");
      const capture = captureFetch([
        jsonResponse({}),
        jsonResponse({ version: { tag: "v0.59.0" }, "token-features": {} }),
      ]);
      vi.stubGlobal("fetch", capture.fetch);
      const stderr = captureStderr();

      await runCommand(measureListCommand(), { rawArgs: [] });

      expect(capture.calls.map((call) => call.url)).toEqual([
        "https://m.example.com/api/measure",
        "https://m.example.com/api/session/properties",
      ]);
      expect(errorEnvelopeOf(stderr)).toEqual(shapeErrorEnvelope(SHAPE_LEAD));
      expect(await readProfileRecord("default")).toEqual(before);
    });

    it("reports the error unchanged when the re-probe itself fails", async () => {
      await seedProbedProfile("default", probeAt(59));
      const before = await readProfileRecord("default");
      const capture = captureFetch([jsonResponse({}), new TypeError("fetch failed")]);
      vi.stubGlobal("fetch", capture.fetch);
      const stderr = captureStderr();

      await runCommand(measureListCommand(), { rawArgs: [] });

      expect(errorEnvelopeOf(stderr)).toEqual(shapeErrorEnvelope(SHAPE_LEAD));
      expect(process.exitCode).toBe(1);
      expect(await readProfileRecord("default")).toEqual(before);
    });

    it("never re-probes when the profile the client ran on was not the cached one", async () => {
      await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
      const capture = captureFetch([
        jsonResponse({ version: { tag: "v0.59.0" }, "token-features": {} }),
        jsonResponse({}),
      ]);
      vi.stubGlobal("fetch", capture.fetch);
      const stderr = captureStderr();

      await runCommand(measureListCommand(), { rawArgs: [] });

      expect(capture.calls.map((call) => call.url)).toEqual([
        "https://m.example.com/api/session/properties",
        "https://m.example.com/api/measure",
      ]);
      expect(errorEnvelopeOf(stderr)).toEqual(shapeErrorEnvelope(SHAPE_LEAD));
    });

    it("re-probes on a shape error even when the preflight was skipped", async () => {
      await seedProbedProfile("default", probeAt(58));
      const capture = captureFetch([
        jsonResponse({}),
        jsonResponse({ version: { tag: "v0.63.0" }, "token-features": {} }),
      ]);
      vi.stubGlobal("fetch", capture.fetch);
      const stderr = captureStderr();
      const cmd = defineMetabaseCommand({
        meta: { name: "skips-then-drifts", description: "skips preflight" },
        args: { ...connectionFlags },
        requires: ["measure.list"],
        async run({ getClient }) {
          const client = await getClient();
          await client.measure.list();
        },
      });

      await runCommand(cmd, { rawArgs: ["--skip-preflight"] });

      expect(errorEnvelopeOf(stderr)).toEqual(
        shapeErrorEnvelope(
          "On Metabase v0.58.0 the response shape was unexpected:\n" +
            "  Invalid input: expected array, received object\n" +
            "The server's version changed since the last probe (was v0.58.0, now v0.63.0); the profile was refreshed — retry the command.",
        ),
      );
    });
  });

  describe("re-probe on a refusal", () => {
    const ACTIVATION_REFUSAL =
      "This operation requires Metabase v61+ (this server is v0.58.0). Upgrade Metabase to use it.";
    const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";

    function activationCommand() {
      return defineMetabaseCommand({
        meta: { name: "needs-activation", description: "wants job activation" },
        args: {},
        requires: ["transformJob.setActive"],
        async run({ getClient }) {
          await getClient();
        },
      });
    }

    it("re-probes once, writes an upgraded server back, and tells the user to retry", async () => {
      await seedProbedProfile("default", probeAt(58));
      vi.setSystemTime(new Date(REPROBED_AT));
      const capture = captureFetch([
        jsonResponse({ version: { tag: "v0.61.3" }, "token-features": {} }),
      ]);
      vi.stubGlobal("fetch", capture.fetch);
      const stderr = captureStderr();

      await runCommand(activationCommand(), { rawArgs: [] });

      expect(capture.calls.map((call) => call.url)).toEqual([
        "https://m.example.com/api/session/properties",
      ]);
      expect(errorEnvelopeOf(stderr)).toEqual(
        capabilityErrorEnvelope(
          `${ACTIVATION_REFUSAL}\n` +
            "The server's version changed since the last probe (was v0.58.0, now v0.61.3); the profile was refreshed — retry the command.",
        ),
      );
      expect(process.exitCode).toBe(2);
      expect(await readProfileRecord("default")).toEqual(
        reprobedRecord({
          at: REPROBED_AT,
          edition: "oss",
          version: { tag: "v0.61.3", major: 61, patch: 3 },
          date: null,
          hash: null,
          tokenFeatures: {},
          user: { id: 1, name: "Tester", isAdmin: true },
        }),
      );
    });

    it("reports the refusal unchanged and leaves the profile alone when the server has not changed", async () => {
      await seedProbedProfile("default", probeAt(58));
      const before = await readProfileRecord("default");
      const capture = captureFetch([
        jsonResponse({ version: { tag: "v0.58.0" }, "token-features": {} }),
      ]);
      vi.stubGlobal("fetch", capture.fetch);
      const stderr = captureStderr();

      await runCommand(activationCommand(), { rawArgs: [] });

      expect(errorEnvelopeOf(stderr)).toEqual(
        capabilityErrorEnvelope(`${ACTIVATION_REFUSAL}\n${DOWNGRADE_REMEDY}`),
      );
      expect(await readProfileRecord("default")).toEqual(before);
    });
  });

  it("bypasses the preflight check when --skip-preflight is passed", async () => {
    await seedProbedProfile("default", probeAt(58));

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "skip-preflight-flag", description: "skip via flag" },
      args: { ...connectionFlags },
      requires: ["transformJob.setActive"],
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: ["--skip-preflight"] });
    expect(ran).toHaveBeenCalledOnce();
  });

  it("lets the client refuse a gated method the command's own declaration does not cover", async () => {
    await seedProbedProfile("default", probeAt(58));
    vi.stubGlobal("fetch", captureFetch([sameServerProbe(58)]).fetch);
    const stderr = captureStderr();

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "under-declared", description: "declares less than it calls" },
      args: {},
      requires: [],
      async run({ getClient }) {
        const client = await getClient();
        await client.measure.list();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain(
      "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
    );
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("switches the client's own check off too when --skip-preflight is passed", async () => {
    await seedProbedProfile("default", probeAt(58));
    const capture = captureFetch([jsonResponse([])]);
    vi.stubGlobal("fetch", capture.fetch);

    const seen = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "skip-reaches-wire", description: "skip reaches the wire" },
      args: { ...connectionFlags },
      requires: ["measure.list"],
      async run({ getClient }) {
        const client = await getClient();
        seen(await client.measure.list());
      },
    });

    await runCommand(cmd, { rawArgs: ["--skip-preflight"] });

    expect(capture.calls.map((call) => call.url)).toEqual(["https://m.example.com/api/measure"]);
    expect(seen.mock.calls).toEqual([[{ data: [], total: null }]]);
  });

  it("bypasses the preflight check when MB_CLI_SKIP_PREFLIGHT=1 is set", async () => {
    await seedProbedProfile("default", probeAt(58));
    process.env[SKIP_PREFLIGHT_ENV] = "1";

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "skip-preflight", description: "skip" },
      args: {},
      requires: ["transformJob.setActive"],
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });
    expect(ran).toHaveBeenCalledOnce();
  });
});
