import { access, constants } from "node:fs/promises";
import { join } from "node:path";

import {
  PROVIDER_KINDS,
  PROVIDER_LABELS,
  type ProviderHealth,
  type ProviderHealthList,
  type ProviderKind,
} from "../../contracts/providers";
import type { ProviderPreference } from "../../contracts/settings";
import type { MergedPath } from "../process/path";
import { outputTail, type CommandResult, type RunCommand } from "../process/spawn";

import type { ModelCatalog, ProviderProbe, ProviderProbeResult } from "./adapter";

const VERSION_ARGS = ["--version"] as const;
const VERSION_TIMEOUT_MS = 10_000;
const VERSION_OUTPUT_LIMIT_BYTES = 8 * 1024;

const RESCAN_INTERVAL_MS = 60_000;

const VERSION_PATTERN = /\d+\.\d+(?:\.\d+)?(?:[-+][\dA-Za-z.-]+)?/;
const WINDOWS_PLATFORM = "win32";
const WINDOWS_EXECUTABLE_SUFFIXES = ["", ".cmd", ".exe", ".bat"] as const;
const PATH_ENV_VAR = "PATH";

interface DetectionMissing {
  readonly kind: "missing";
}

interface DetectionVersionFailed {
  readonly kind: "version-failed";
  readonly path: string;
  readonly result: CommandResult;
}

interface DetectionProbed {
  readonly kind: "probed";
  readonly path: string;
  readonly version: string | null;
  readonly result: ProviderProbeResult;
}

type DetectionOutcome = DetectionMissing | DetectionVersionFailed | DetectionProbed;

interface HealthInput {
  readonly kind: ProviderKind;
  readonly outcome: DetectionOutcome;
  readonly catalog: ModelCatalog;
  readonly checkedAt: string;
}

function versionFailureMessage(label: string, result: CommandResult): string {
  if (result.kind === "spawn-failed") {
    return `${label} could not be run: ${result.message}`;
  }
  if (result.kind === "timed-out") {
    return `${label} did not answer \`--version\` within ${result.timeoutMs} ms.`;
  }
  const tail = outputTail(result);
  const exit = `${label} exited ${result.code} for \`--version\`.`;
  return tail === null ? exit : `${exit} ${tail}`;
}

export function providerHealth(input: HealthInput): ProviderHealth {
  const label = PROVIDER_LABELS[input.kind];
  const outcome = input.outcome;
  const models = [...input.catalog.models];
  const defaultModel = input.catalog.defaultModel;
  if (outcome.kind === "missing") {
    return {
      kind: input.kind,
      installed: false,
      path: null,
      version: null,
      status: "missing",
      account: null,
      models,
      defaultModel,
      message: `${label} is not installed, or not on the PATH this app reads. Install it, then rescan.`,
      checkedAt: input.checkedAt,
    };
  }
  if (outcome.kind === "version-failed") {
    return {
      kind: input.kind,
      installed: true,
      path: outcome.path,
      version: null,
      status: "error",
      account: null,
      models,
      defaultModel,
      message: versionFailureMessage(label, outcome.result),
      checkedAt: input.checkedAt,
    };
  }
  return {
    kind: input.kind,
    installed: true,
    path: outcome.path,
    version: outcome.version,
    status: outcome.result.status,
    account: outcome.result.account,
    models,
    defaultModel,
    message: outcome.result.message,
    checkedAt: input.checkedAt,
  };
}

export function readVersion(stdout: string, stderr: string): string | null {
  const printed = VERSION_PATTERN.exec(`${stdout}\n${stderr}`);
  return printed === null ? null : printed[0];
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateNames(name: string, platform: string): readonly string[] {
  if (platform !== WINDOWS_PLATFORM) {
    return [name];
  }
  return WINDOWS_EXECUTABLE_SUFFIXES.map((suffix) => `${name}${suffix}`);
}

async function resolveBinary(
  name: string,
  override: string | null,
  entries: readonly string[],
  platform: string,
): Promise<string | null> {
  if (override !== null) {
    return (await isExecutable(override)) ? override : null;
  }
  for (const directory of entries) {
    for (const candidate of candidateNames(name, platform)) {
      const full = join(directory, candidate);
      if (await isExecutable(full)) {
        return full;
      }
    }
  }
  return null;
}

interface DetectorDeps {
  readonly probes: Readonly<Record<ProviderKind, ProviderProbe>>;
  readonly preferences: () => Readonly<Record<ProviderKind, ProviderPreference>>;
  readonly path: () => Promise<MergedPath>;
  readonly env: NodeJS.ProcessEnv;
  readonly run: RunCommand;
  readonly now: () => number;
  readonly platform: string;
  readonly signal: AbortSignal;
}

export class ProviderDetector {
  private cached: ProviderHealthList | null = null;
  private cachedAt: number | null = null;
  private inFlight: Promise<ProviderHealthList> | null = null;

  constructor(private readonly deps: DetectorDeps) {}

  read(): Promise<ProviderHealthList> {
    const cached = this.cached;
    const cachedAt = this.cachedAt;
    if (cached !== null && cachedAt !== null && this.deps.now() - cachedAt < RESCAN_INTERVAL_MS) {
      return Promise.resolve(cached);
    }
    return this.rescan();
  }

  rescan(): Promise<ProviderHealthList> {
    this.inFlight ??= this.scan();
    return this.inFlight;
  }

  private async scan(): Promise<ProviderHealthList> {
    try {
      const path = await this.deps.path();
      const preferences = this.deps.preferences();
      const health = await Promise.all(
        PROVIDER_KINDS.map((kind) => this.detect(kind, preferences[kind], path)),
      );
      this.cached = health;
      this.cachedAt = this.deps.now();
      return health;
    } finally {
      this.inFlight = null;
    }
  }

  private async detect(
    kind: ProviderKind,
    preference: ProviderPreference,
    path: MergedPath,
  ): Promise<ProviderHealth> {
    const checkedAt = new Date(this.deps.now()).toISOString();
    const probe = this.deps.probes[kind];
    const binaryPath = await resolveBinary(
      probe.binaryName,
      preference.binaryPath,
      path.entries,
      this.deps.platform,
    );
    if (binaryPath === null) {
      return providerHealth({
        kind,
        outcome: { kind: "missing" },
        catalog: probe.fallbackModels,
        checkedAt,
      });
    }
    const env = { ...this.deps.env, [PATH_ENV_VAR]: path.value };
    const version = await this.deps.run({
      command: binaryPath,
      args: VERSION_ARGS,
      env,
      cwd: null,
      timeoutMs: VERSION_TIMEOUT_MS,
      maxOutputBytes: VERSION_OUTPUT_LIMIT_BYTES,
      signal: this.deps.signal,
    });
    if (version.kind !== "exited" || version.code !== 0) {
      return providerHealth({
        kind,
        outcome: { kind: "version-failed", path: binaryPath, result: version },
        catalog: probe.fallbackModels,
        checkedAt,
      });
    }
    const result = await probe.probe({
      binaryPath,
      env,
      run: this.deps.run,
      signal: this.deps.signal,
    });
    const listed =
      result.status === "ready"
        ? await probe.listModels({ binaryPath, env, signal: this.deps.signal })
        : null;
    return providerHealth({
      kind,
      outcome: {
        kind: "probed",
        path: binaryPath,
        version: readVersion(version.stdout, version.stderr),
        result,
      },
      catalog: listed ?? probe.fallbackModels,
      checkedAt,
    });
  }
}
