import { describe, expect, it } from "vitest";

import type { ProviderHealth, ProviderKind } from "../../contracts/providers";
import type { CommandResult } from "../process/spawn";

import type { ModelCatalog, ProviderProbe, ProviderProbeResult } from "./adapter";
import { ProviderDetector, providerHealth, readVersion } from "./detect";

const CHECKED_AT = "2026-09-22T12:00:00.000Z";
const CLAUDE_PATH = "/usr/local/bin/claude";

const MODELS: ModelCatalog = {
  models: [
    { id: "deep", label: "Deep", resolvedId: null },
    { id: "fast", label: "Fast", resolvedId: null },
  ],
  defaultModel: "deep",
};

function expectedHealth(fields: Partial<ProviderHealth>): ProviderHealth {
  return {
    kind: "claude",
    installed: true,
    path: CLAUDE_PATH,
    version: null,
    status: "error",
    account: null,
    models: [...MODELS.models],
    defaultModel: MODELS.defaultModel,
    message: null,
    checkedAt: CHECKED_AT,
    ...fields,
  };
}

function versionFailed(result: CommandResult): ProviderHealth {
  return providerHealth({
    kind: "claude",
    outcome: { kind: "version-failed", path: CLAUDE_PATH, result },
    catalog: MODELS,
    checkedAt: CHECKED_AT,
  });
}

function probed(version: string | null, result: ProviderProbeResult): ProviderHealth {
  return providerHealth({
    kind: "claude",
    outcome: { kind: "probed", path: CLAUDE_PATH, version, result },
    catalog: MODELS,
    checkedAt: CHECKED_AT,
  });
}

describe("providerHealth", () => {
  it("reports a binary that is not on PATH as missing", () => {
    expect(
      providerHealth({
        kind: "claude",
        outcome: { kind: "missing" },
        catalog: MODELS,
        checkedAt: CHECKED_AT,
      }),
    ).toEqual(
      expectedHealth({
        installed: false,
        path: null,
        status: "missing",
        message:
          "Claude Code is not installed, or not on the PATH this app reads. Install it, then rescan.",
      }),
    );
  });

  it("reports a version probe that timed out with the deadline it missed", () => {
    expect(
      versionFailed({
        kind: "timed-out",
        timeoutMs: 10_000,
        stdout: "",
        stderr: "",
        truncated: false,
      }),
    ).toEqual(
      expectedHealth({ message: "Claude Code did not answer `--version` within 10000 ms." }),
    );
  });

  it("reports a binary that would not start with the reason it gave", () => {
    expect(versionFailed({ kind: "spawn-failed", message: "EACCES: permission denied" })).toEqual(
      expectedHealth({ message: "Claude Code could not be run: EACCES: permission denied" }),
    );
  });

  it("reports a non-zero exit with its code and the tail it printed", () => {
    expect(
      versionFailed({
        kind: "exited",
        code: 3,
        stdout: "",
        stderr: "unknown flag --version\n",
        truncated: false,
      }),
    ).toEqual(
      expectedHealth({ message: "Claude Code exited 3 for `--version`. unknown flag --version" }),
    );
  });

  it("reports a non-zero exit that printed nothing without a tail", () => {
    expect(
      versionFailed({ kind: "exited", code: 1, stdout: "", stderr: "", truncated: false }),
    ).toEqual(expectedHealth({ message: "Claude Code exited 1 for `--version`." }));
  });

  it("carries the probe's unauthenticated answer through with the version it found", () => {
    expect(
      probed("2.1.278", {
        status: "unauthenticated",
        account: null,
        message: "Run `claude login`, then rescan.",
      }),
    ).toEqual(
      expectedHealth({
        version: "2.1.278",
        status: "unauthenticated",
        message: "Run `claude login`, then rescan.",
      }),
    );
  });

  it("carries the probe's ready answer through with its account", () => {
    expect(
      probed("2.1.278", {
        status: "ready",
        account: { label: "Metabase", email: "someone@metabase.com" },
        message: null,
      }),
    ).toEqual(
      expectedHealth({
        version: "2.1.278",
        status: "ready",
        account: { label: "Metabase", email: "someone@metabase.com" },
      }),
    );
  });

  it("reports a version the binary did not print as unknown", () => {
    expect(probed(null, { status: "ready", account: null, message: null })).toEqual(
      expectedHealth({ version: null, status: "ready" }),
    );
  });
});

describe("readVersion", () => {
  it("takes the version out of the line the binary printed", () => {
    expect(readVersion("2.1.278 (Claude Code)\n", "")).toBe("2.1.278");
  });

  it("falls back to what the binary printed on stderr", () => {
    expect(readVersion("", "codex-cli 0.153.4\n")).toBe("0.153.4");
  });

  it("is null when nothing in the output looks like a version", () => {
    expect(readVersion("no version here", "")).toBe(null);
  });
});

interface DetectorHarness {
  readonly detector: ProviderDetector;
  readonly scans: () => number;
  advance(milliseconds: number): void;
}

const READY_PROBE: ProviderProbeResult = {
  status: "ready",
  account: null,
  message: null,
};

function fakeProbe(kind: ProviderKind): ProviderProbe {
  return {
    kind,
    binaryName: kind,
    fallbackModels: MODELS,
    listModels: async () => null,
    probe: async () => READY_PROBE,
  };
}

interface HarnessOptions {
  readonly binaryPath: string | null;
}

const INSTALLED: HarnessOptions = { binaryPath: process.execPath };

function detectorHarness(options: HarnessOptions = INSTALLED): DetectorHarness {
  let clock = Date.parse(CHECKED_AT);
  let scans = 0;
  const detector = new ProviderDetector({
    probes: { claude: fakeProbe("claude"), codex: fakeProbe("codex") },
    preferences: () => ({
      claude: { enabled: true, binaryPath: options.binaryPath },
      codex: { enabled: true, binaryPath: options.binaryPath },
    }),
    path: async () => {
      scans += 1;
      return { entries: [], value: "", loginShell: { kind: "read", shell: "/bin/zsh" } };
    },
    env: {},
    run: async () => ({ kind: "exited", code: 0, stdout: "1.0.0", stderr: "", truncated: false }),
    now: () => clock,
    platform: "linux",
    signal: new AbortController().signal,
  });
  return {
    detector,
    scans: () => scans,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
  };
}

describe("ProviderDetector", () => {
  it("answers a second read inside the minute from the stored result", async () => {
    const harness = detectorHarness();

    await harness.detector.read();
    harness.advance(59_999);
    await harness.detector.read();

    expect(harness.scans()).toBe(1);
  });

  it("scans again once the minute has passed", async () => {
    const harness = detectorHarness();

    await harness.detector.read();
    harness.advance(60_000);
    await harness.detector.read();

    expect(harness.scans()).toBe(2);
  });

  it("scans whenever the caller asks for a rescan", async () => {
    const harness = detectorHarness();

    await harness.detector.read();
    await harness.detector.rescan();

    expect(harness.scans()).toBe(2);
  });

  it("reports one health record per known provider", async () => {
    const harness = detectorHarness();

    const detected = await harness.detector.read();

    expect(detected.map((record) => record.kind)).toEqual(["claude", "codex"]);
  });

  it("names the models of a provider whose binary is not on PATH", async () => {
    const harness = detectorHarness({ binaryPath: null });

    const detected = await harness.detector.read();

    expect(detected).toEqual([
      {
        kind: "claude",
        installed: false,
        path: null,
        version: null,
        status: "missing",
        account: null,
        models: [...MODELS.models],
        defaultModel: MODELS.defaultModel,
        message:
          "Claude Code is not installed, or not on the PATH this app reads. Install it, then rescan.",
        checkedAt: CHECKED_AT,
      },
      {
        kind: "codex",
        installed: false,
        path: null,
        version: null,
        status: "missing",
        account: null,
        models: [...MODELS.models],
        defaultModel: MODELS.defaultModel,
        message:
          "Codex is not installed, or not on the PATH this app reads. Install it, then rescan.",
        checkedAt: CHECKED_AT,
      },
    ]);
  });
});
