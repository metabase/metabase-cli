import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { ChildProcess } from "node:child_process";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

const EVIDENCE_DIR_ENV_VAR = "RDE_EVIDENCE_DIR";
const APP_DIR = resolve(import.meta.dirname, "..");
const MAIN_ENTRY = join(APP_DIR, "out", "main", "index.js");
const EXIT_TIMEOUT_MS = 10_000;
const EXIT_POLL_MS = 100;
const PROC_DIR = "/proc";

export const PRODUCT_NAME = "RDE";
export const WINDOW_TIMEOUT_MS = 30_000;

export class DriverFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriverFailure";
  }
}

export async function evidenceDir(env: NodeJS.ProcessEnv): Promise<string> {
  const dir = env[EVIDENCE_DIR_ENV_VAR];
  if (dir === undefined) {
    throw new DriverFailure(`${EVIDENCE_DIR_ENV_VAR} is not set; it names where evidence goes`);
  }
  await mkdir(dir, { recursive: true });
  return dir;
}

export function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-");
}

// Unset, a driver runs the build under `out/` on the workspace's Electron; set, it runs the
// packaged executable, which carries its own Electron and resources.
const PACKAGED_APP_ENV_VAR = "RDE_PACKAGED_APP";

interface BuiltApp {
  readonly kind: "built";
}

interface PackagedApp {
  readonly kind: "packaged";
  readonly executable: string;
}

type AppTarget = BuiltApp | PackagedApp;

export function appTarget(env: NodeJS.ProcessEnv): AppTarget {
  const executable = env[PACKAGED_APP_ENV_VAR];
  return executable === undefined ? { kind: "built" } : { kind: "packaged", executable };
}

async function requireFile(path: string, fix: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new DriverFailure(`${path} is missing; ${fix}`);
  }
}

interface Launch {
  readonly executablePath: string;
  readonly entryArgs: readonly string[];
}

async function resolveLaunch(target: AppTarget): Promise<Launch> {
  if (target.kind === "packaged") {
    await requireFile(target.executable, "run `bun run dist:desktop:linux` first");
    return { executablePath: target.executable, entryArgs: [] };
  }
  await requireFile(MAIN_ENTRY, "run `bun run build:desktop` first");
  return { executablePath: electronExecutable(), entryArgs: [MAIN_ENTRY] };
}

// Loaded from plain Node, the package resolves to its executable's path and downloads the binary
// first when the install left it out.
function electronExecutable(): string {
  const require = createRequire(import.meta.url);
  const executable: unknown = require("electron");
  if (typeof executable !== "string") {
    throw new DriverFailure("the electron package did not resolve to an executable path");
  }
  return executable;
}

interface ProcessRecord {
  readonly pid: number;
  readonly parentPid: number;
  readonly state: string;
}

async function readProcessRecord(pid: number): Promise<ProcessRecord | null> {
  try {
    const stat = await readFile(join(PROC_DIR, String(pid), "stat"), "utf8");
    const afterCommand = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(" ");
    const state = afterCommand[0];
    const parentPid = afterCommand[1];
    if (state === undefined || parentPid === undefined) {
      throw new DriverFailure(`Unreadable ${PROC_DIR}/${pid}/stat: ${stat}`);
    }
    return { pid, parentPid: Number(parentPid), state };
  } catch (error) {
    if (error instanceof DriverFailure) {
      throw error;
    }
    return null;
  }
}

async function listProcesses(): Promise<ProcessRecord[]> {
  const entries = await readdir(PROC_DIR);
  const pids = entries.filter((entry) => /^\d+$/.test(entry)).map(Number);
  const records = await Promise.all(pids.map(readProcessRecord));
  return records.filter((record): record is ProcessRecord => record !== null);
}

export async function descendantsOf(rootPid: number): Promise<number[]> {
  const processes = await listProcesses();
  const found: number[] = [];
  const frontier = [rootPid];
  while (frontier.length > 0) {
    const parent = frontier.pop();
    if (parent === undefined) {
      break;
    }
    for (const record of processes) {
      if (record.parentPid === parent) {
        found.push(record.pid);
        frontier.push(record.pid);
      }
    }
  }
  return found;
}

async function isAlive(pid: number): Promise<boolean> {
  const record = await readProcessRecord(pid);
  return record !== null && record.state !== "Z";
}

async function waitForExit(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  while (child.exitCode === null && child.signalCode === null) {
    if (Date.now() > deadline) {
      throw new DriverFailure(`Electron main process ${child.pid} is still running after close`);
    }
    await sleep(EXIT_POLL_MS);
  }
}

async function waitForOrphansToExit(pids: number[]): Promise<void> {
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  let alive = pids;
  while (alive.length > 0) {
    const checks = await Promise.all(alive.map(async (pid) => ((await isAlive(pid)) ? pid : null)));
    alive = checks.filter((pid): pid is number => pid !== null);
    if (alive.length === 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new DriverFailure(`Child processes survived the quit: ${alive.join(", ")}`);
    }
    await sleep(EXIT_POLL_MS);
  }
}

export type LaunchEnv = Readonly<Record<string, string>>;

export interface LaunchOptions {
  readonly userDataDir: string | null;
  readonly extraArgs: readonly string[];
  readonly env: LaunchEnv;
}

// Playwright hands the child a complete environment, so a variable the parent left unset is
// dropped rather than passed as the string "undefined".
export function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      defined[name] = value;
    }
  }
  return defined;
}

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly rendererErrors: readonly string[];
}

const launched: ElectronApplication[] = [];

export async function killSurvivors(): Promise<void> {
  for (const app of launched.splice(0)) {
    const child = app.process();
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    const children = child.pid === undefined ? [] : await descendantsOf(child.pid);
    child.kill("SIGKILL");
    for (const pid of children) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        continue;
      }
    }
  }
}

export async function launchApp(options: LaunchOptions): Promise<RunningApp> {
  const launch = await resolveLaunch(appTarget(process.env));
  const userData = options.userDataDir === null ? [] : [`--user-data-dir=${options.userDataDir}`];
  const app = await electron.launch({
    executablePath: launch.executablePath,
    // Chromium's process sandbox needs unprivileged user namespaces, which a hardened kernel
    // withholds; the renderer's own sandbox (webPreferences.sandbox) is unaffected.
    args: [...launch.entryArgs, "--no-sandbox", ...userData, ...options.extraArgs],
    env: options.env,
  });
  const rendererErrors: string[] = [];
  app.on("window", (page: Page) => {
    page.on("console", (message) => {
      if (message.type() === "error") {
        const where = message.location();
        rendererErrors.push(
          `console.error: ${message.text()} (${where.url}:${where.lineNumber}:${where.columnNumber})`,
        );
      }
    });
    page.on("pageerror", (error) => {
      rendererErrors.push(`pageerror: ${error.message}`);
    });
  });
  launched.push(app);
  return { app, rendererErrors };
}

export async function closeApp(running: RunningApp): Promise<void> {
  const index = launched.indexOf(running.app);
  if (index >= 0) {
    launched.splice(index, 1);
  }
  const mainProcess = running.app.process();
  if (mainProcess.pid === undefined) {
    throw new DriverFailure("Electron main process has no pid");
  }
  const children = await descendantsOf(mainProcess.pid);
  await running.app.close();
  await waitForExit(mainProcess);
  await waitForOrphansToExit(children);
  if (running.rendererErrors.length > 0) {
    throw new DriverFailure(`Renderer reported errors:\n${running.rendererErrors.join("\n")}`);
  }
}
