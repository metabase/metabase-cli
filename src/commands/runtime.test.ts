import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTempConfigHome, type TempConfigHome } from "../core/auth/temp-config-home";
import type { ServerInfo } from "../core/version/probe";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

const { defineMetabaseCommand, SKIP_PREFLIGHT_ENV } = await import("./runtime");
const { connectionFlags, outputFlags, profileFlag } = await import("./flags");
const { writeProbeResult, writeProfile } = await import("../core/auth/storage");

async function seedProbedProfile(name: string, info: ServerInfo): Promise<void> {
  await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" }, name);
  await writeProbeResult(name, {
    user: { id: 1, name: "Tester", isAdmin: true },
    server: info,
  });
}

function fakeServerInfo(major: number): ServerInfo {
  return {
    version: { tag: `v0.${major}.0`, major, patch: 0 },
    tokenFeatures: null,
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

describe("defineMetabaseCommand", () => {
  let home: TempConfigHome;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
    delete process.env["METABASE_URL"];
    delete process.env["METABASE_API_KEY"];
    delete process.env["METABASE_PROFILE"];
    delete process.env[SKIP_PREFLIGHT_ENV];
    previousExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    home.cleanup();
    delete process.env[SKIP_PREFLIGHT_ENV];
    process.exitCode = previousExitCode;
  });

  it("resolves opted-in output flags into ctx and exposes custom flags on args", async () => {
    const observed = vi.fn<(format: string, custom: string | undefined) => void>();

    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo" },
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
    const cmd = defineMetabaseCommand({
      meta: { name: "no-client", description: "does not need the client" },
      args: {},
      run() {
        return;
      },
    });

    await expect(runCommand(cmd, { rawArgs: [] })).resolves.toBeDefined();
  });

  it("returns the same client instance across multiple getClient() calls", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    let first: unknown;
    let second: unknown;
    const cmd = defineMetabaseCommand({
      meta: { name: "cached", description: "client is cached" },
      args: {},
      async run({ getClient }) {
        first = await getClient();
        second = await getClient();
      },
    });
    await runCommand(cmd, { rawArgs: [] });
    expect(first).toBe(second);
  });

  it("reports ConfigError to stderr and sets exitCode 2 when no credentials are available", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-creds", description: "needs creds" },
      args: {},
      async run({ getClient }) {
        await getClient();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain('Not authenticated for profile "default"');
    expect(process.exitCode).toBe(2);
  });

  it("refuses with CapabilityError exit code 2 when the cached server major is below required minVersion", async () => {
    await seedProbedProfile("default", fakeServerInfo(58));

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-v60", description: "wants v60" },
      args: {},
      capabilities: { minVersion: 60 },
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain(
      "This command requires Metabase v60+ (this server is v0.58.0). Upgrade Metabase or pin mb-cli to an older release.",
    );
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("refuses with CapabilityError exit code 2 when the required premium token-feature is absent", async () => {
    await seedProbedProfile("default", fakeServerInfo(58));

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-transforms", description: "wants transforms" },
      args: {},
      capabilities: { tokenFeature: "transforms" },
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain(
      "This command requires the 'transforms' premium feature (not enabled on this server).",
    );
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("runs a baseline-capabilities command without consulting the cached probe", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "no-caps", description: "no caps" },
      args: {},
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });
    expect(ran).toHaveBeenCalledOnce();
  });

  it("warns to stderr but proceeds when the profile has no cached probe", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-v60-warn", description: "wants v60" },
      args: {},
      capabilities: { minVersion: 60 },
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    const joined = stderr.join("");
    expect(joined).toContain(
      "Could not detect Metabase server version. Proceeding without preflight check; failures may produce confusing errors.",
    );
    expect(joined).toContain(
      "Run `mb auth list` (or `mb auth login`) to populate the version cache.",
    );
    expect(ran).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(0);
  });

  it("bypasses the preflight check when --skip-preflight is passed", async () => {
    await seedProbedProfile("default", fakeServerInfo(58));

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "skip-preflight-flag", description: "skip via flag" },
      args: { ...connectionFlags },
      capabilities: { minVersion: 99 },
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: ["--skip-preflight"] });
    expect(ran).toHaveBeenCalledOnce();
  });

  it("bypasses the preflight check when METABASE_CLI_SKIP_PREFLIGHT=1 is set", async () => {
    await seedProbedProfile("default", fakeServerInfo(58));
    process.env[SKIP_PREFLIGHT_ENV] = "1";

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "skip-preflight", description: "skip" },
      args: {},
      capabilities: { minVersion: 99 },
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });
    expect(ran).toHaveBeenCalledOnce();
  });
});
