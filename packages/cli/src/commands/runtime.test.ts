import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerInfo } from "@metabase/client/version/probe";

import { setupTempConfigHome, type TempConfigHome } from "../core/auth/temp-config-home";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

const { defineMetabaseCommand, SKIP_PREFLIGHT_ENV } = await import("./runtime");
const { connectionFlags, listFlags, outputFlags, profileFlag, worktreeFlag } =
  await import("./flags");
const { writeProbeResult, writeProfile, writeProfileWorktree } =
  await import("../core/auth/storage");
const { setVerbChain } = await import("../runtime/verb-chain");

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
    delete process.env["MB_WORKTREE"];
    for (const name of ["URL", "API_KEY", "PROFILE"]) {
      delete process.env[`MB_${name}`];
      delete process.env[`METABASE_${name}`];
    }
    delete process.env[SKIP_PREFLIGHT_ENV];
    setVerbChain(null);
    previousExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    home.cleanup();
    setVerbChain(null);
    delete process.env["MB_WORKTREE"];
    delete process.env[SKIP_PREFLIGHT_ENV];
    process.exitCode = previousExitCode;
  });

  it("resolves opted-in output flags into ctx and exposes custom flags on args", async () => {
    const observed = vi.fn<(format: string, custom: string | undefined) => void>();

    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo" },
      capabilities: {},
      worktree: "any",
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
      capabilities: {},
      worktree: "any",
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
      capabilities: {},
      worktree: "any",
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
      capabilities: {},
      worktree: "any",
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
      capabilities: {},
      worktree: "any",
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
      capabilities: {},
      worktree: "any",
      args: {},
      async run({ getClient }) {
        await getClient();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    const parsed: unknown = JSON.parse(stderr.join(""));
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
      capabilities: {},
      worktree: "any",
      args: { ...outputFlags, ...listFlags },
      run() {
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: ["--json", "--limit", "0"] });

    const parsed: unknown = JSON.parse(stderr.join(""));
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
      capabilities: {},
      worktree: "any",
      args: { ...outputFlags },
      run() {
        return;
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: ["--json", "--max-bytes", "abc"] });

    const parsed: unknown = JSON.parse(stderr.join(""));
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

  it("reports an unresolvable --format as plain text, there being no format to serialize into", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "misformatted", description: "bad format" },
      capabilities: {},
      worktree: "any",
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

  it("refuses with CapabilityError exit code 2 when the cached server major is below required minVersion", async () => {
    await seedProbedProfile("default", fakeServerInfo(58));

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-v60", description: "wants v60" },
      args: {},
      capabilities: { minVersion: 60 },
      worktree: "any",
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain(
      "This operation requires Metabase v60+ (this server is v0.58.0). Upgrade Metabase to use it.",
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
      worktree: "any",
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).toContain(
      "This operation requires the 'transforms' premium feature (not enabled on this server).",
    );
    expect(process.exitCode).toBe(2);
    expect(ran).not.toHaveBeenCalled();
  });

  it("runs a baseline-capabilities command without consulting the cached probe", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "no-caps", description: "no caps" },
      capabilities: {},
      worktree: "any",
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
      worktree: "any",
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

  it("proceeds without any version warning when the cached probe has a non-numeric version", async () => {
    await seedProbedProfile("default", { version: null, tokenFeatures: null });

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "needs-v60-unknown", description: "wants v60" },
      args: {},
      capabilities: { minVersion: 60 },
      worktree: "any",
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    expect(stderr.join("")).not.toContain("Could not detect Metabase server version");
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
      worktree: "any",
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: ["--skip-preflight"] });
    expect(ran).toHaveBeenCalledOnce();
  });

  it("refuses a main-only command under an MB_WORKTREE scope before any request", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    process.env["MB_WORKTREE"] = "feat/transforms";
    setVerbChain("transform run");

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "run", description: "runs main-app content" },
      capabilities: {},
      worktree: "main-only",
      args: {},
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    const parsed: unknown = JSON.parse(stderr.join(""));
    expect(parsed).toEqual({
      ok: false,
      error: {
        category: "config",
        message:
          'transform run is not available inside a worktree (scope: worktree "feat/transforms" ' +
          "from MB_WORKTREE); it changes main-app content. Unpin the profile " +
          "(`mb worktree unpin`) or drop MB_WORKTREE to run it against the main app.",
        exitCode: 2,
      },
    });
    expect(ran).not.toHaveBeenCalled();
  });

  it("names the leaf in a main-only refusal when no verb chain was recorded", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    process.env["MB_WORKTREE"] = "feat/transforms";

    const cmd = defineMetabaseCommand({
      meta: { name: "run", description: "runs main-app content" },
      capabilities: {},
      worktree: "main-only",
      args: {},
      async run({ getClient }) {
        await getClient();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: [] });

    const parsed: unknown = JSON.parse(stderr.join(""));
    expect(parsed).toEqual({
      ok: false,
      error: {
        category: "config",
        message:
          'run is not available inside a worktree (scope: worktree "feat/transforms" from ' +
          "MB_WORKTREE); it changes main-app content. Unpin the profile (`mb worktree unpin`) or " +
          "drop MB_WORKTREE to run it against the main app.",
        exitCode: 2,
      },
    });
  });

  it("runs a main-only command untouched when nothing names a worktree", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "run", description: "runs main-app content" },
      capabilities: {},
      worktree: "main-only",
      args: {},
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });
    expect(ran).toHaveBeenCalledOnce();
  });

  it("hands a scoped command the pinned worktree without contacting the server", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    await writeProfileWorktree("default", { id: 3, branch: "feat/transforms" });

    const observed = vi.fn<(scope: unknown) => void>();
    const cmd = defineMetabaseCommand({
      meta: { name: "scoped", description: "honours a scope" },
      capabilities: {},
      worktree: "scoped",
      args: { ...worktreeFlag },
      async run({ getWorktree }) {
        observed(await getWorktree());
      },
    });

    await runCommand(cmd, { rawArgs: [] });
    expect(observed).toHaveBeenCalledWith({ id: 3, branch: "feat/transforms" });
  });

  it("hands a scoped command a null scope when nothing names a worktree", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });

    const observed = vi.fn<(scope: unknown) => void>();
    const cmd = defineMetabaseCommand({
      meta: { name: "scoped", description: "honours a scope" },
      capabilities: {},
      worktree: "scoped",
      args: { ...worktreeFlag },
      async run({ getWorktree }) {
        observed(await getWorktree());
      },
    });

    await runCommand(cmd, { rawArgs: [] });
    expect(observed).toHaveBeenCalledWith(null);
  });

  it("refuses a --worktree that names a worktree other than the profile's pin", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret-key" });
    await writeProfileWorktree("default", { id: 3, branch: "feat/transforms" });

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "scoped", description: "honours a scope" },
      capabilities: {},
      worktree: "scoped",
      args: { ...worktreeFlag },
      async run({ getWorktree }) {
        await getWorktree();
        ran();
      },
    });
    const stderr = captureStderr();

    await runCommand(cmd, { rawArgs: ["--worktree", "9"] });

    const parsed: unknown = JSON.parse(stderr.join(""));
    expect(parsed).toEqual({
      ok: false,
      error: {
        category: "config",
        message:
          'profile "default" is pinned to worktree 3 (feat/transforms); refusing --worktree 9',
        exitCode: 2,
      },
    });
    expect(ran).not.toHaveBeenCalled();
  });

  it("bypasses the preflight check when MB_CLI_SKIP_PREFLIGHT=1 is set", async () => {
    await seedProbedProfile("default", fakeServerInfo(58));
    process.env[SKIP_PREFLIGHT_ENV] = "1";

    const ran = vi.fn();
    const cmd = defineMetabaseCommand({
      meta: { name: "skip-preflight", description: "skip" },
      args: {},
      capabilities: { minVersion: 99 },
      worktree: "any",
      async run({ getClient }) {
        await getClient();
        ran();
      },
    });

    await runCommand(cmd, { rawArgs: [] });
    expect(ran).toHaveBeenCalledOnce();
  });
});
