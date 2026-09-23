import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Locator, Page } from "playwright";

import { errorMessage } from "@metabase/client/errors";

import { readBootstrap } from "../../../tests/e2e/bootstrap-data";
import type { E2EBootstrap } from "../../../tests/e2e/bootstrap-data";
import { SessionIndex } from "../src/contracts/session";
import { TEST_MODE_ENV_VAR } from "../src/main/ipc";

import {
  DriverFailure,
  WINDOW_TIMEOUT_MS,
  definedEnv,
  killSurvivors,
  launchApp,
  timestamp,
  type RunningApp,
} from "./app";

export const THEME_ENV_VAR = "RDE_THEME";
export const TEST_MODE_ON = "1";
export const NO_SECRET_STORE_ENV_VAR = "RDE_DRIVE_NO_SECRET_STORE";

// Every locator and action fails inside this budget, so a scenario that cannot find what it clicks
// reports which step it was on instead of sitting on Playwright's minute-long defaults.
export const ACTION_TIMEOUT_MS = 20_000;

// A model turn is not an interaction; it takes as long as the model takes.
export const TURN_TIMEOUT_MS = 240_000;

const EXECUTABLE_FILE_MODE = 0o755;

// A model may ask for a command before it asks for the write; each ask is answered until the turn
// lands its checkpoint.
const MAX_PERMISSION_ASKS = 8;

const execFileAsync = promisify(execFile);

export type Note = (line: string) => Promise<void>;

export interface ScenarioContext {
  readonly dir: string;
  readonly bootstrap: () => Promise<E2EBootstrap>;
  readonly note: Note;
  readonly onWindow: (window: Page) => void;
}

// Says why a scenario cannot run on this machine and records its lane as skipped, or answers null.
export type ScenarioGate = (lane: string) => string | null;

export interface Scenario {
  readonly name: string;
  readonly unit: string;
  readonly gate: ScenarioGate | null;
  readonly act: (context: ScenarioContext) => Promise<string>;
}

interface OpenWindow {
  page: Page | null;
}

export async function runScenario(
  scenario: Scenario,
  dir: string,
  commandLine: string,
): Promise<string> {
  const note = noteTo(join(dir, `${timestamp()}_${scenario.unit}-${scenario.name}.log`));
  await note(commandLine);
  const open: OpenWindow = { page: null };
  try {
    return await scenario.act({
      dir,
      bootstrap: readBootstrap,
      note,
      onWindow: (window) => {
        open.page = window;
      },
    });
  } catch (error) {
    await note(`FAILED: ${errorMessage(error)}`);
    const shot = join(dir, `${timestamp()}_${scenario.unit}-${scenario.name}-failed.png`);
    await afterFailure(note, () => shootFailure(open.page, shot, note));
    await afterFailure(note, killSurvivors);
    throw error;
  }
}

// What runs after a scenario fails is evidence and cleanup; its own failure goes into the log and
// never takes the place of the error the scenario threw.
async function afterFailure(note: Note, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    await note(`and the cleanup after it failed too: ${errorMessage(error)}`);
  }
}

async function shootFailure(page: Page | null, path: string, note: Note): Promise<void> {
  if (page === null || page.isClosed()) {
    await note("no window was open to show the screen at that moment");
    return;
  }
  await page.screenshot({ path });
  await note(`the screen at that moment: ${path}`);
}

export async function shoot(
  window: Page,
  dir: string,
  unit: string,
  slug: string,
): Promise<string> {
  const path = join(dir, `${timestamp()}_${unit}-${slug}.png`);
  await window.screenshot({ path });
  return path;
}

export function noteTo(path: string): Note {
  const lines: string[] = [];
  return async (line: string) => {
    lines.push(line);
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  };
}

export async function temporaryDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout;
}

// Storing a credential needs a secret service, and none answers under Xvfb. Electron's own testing
// escape keeps `safeStorage` usable there; setting the variable below withholds it, which is how a
// run reproduces what a machine with no keyring shows the user.
export async function start(userDataDir: string, theme: string | undefined): Promise<RunningApp> {
  return startWithEnv(userDataDir, theme, {});
}

export async function startWithEnv(
  userDataDir: string,
  theme: string | undefined,
  overrides: NodeJS.ProcessEnv,
): Promise<RunningApp> {
  const env = definedEnv({ ...process.env, ...overrides, [TEST_MODE_ENV_VAR]: TEST_MODE_ON });
  if (theme !== undefined) {
    env[THEME_ENV_VAR] = theme;
  }
  const running = await launchApp({ userDataDir, extraArgs: [], env });
  if (process.env[NO_SECRET_STORE_ENV_VAR] === undefined) {
    await running.app.evaluate(({ safeStorage }) => {
      safeStorage.setUsePlainTextEncryption(true);
    });
  }
  return running;
}

export async function openWindow(
  running: RunningApp,
  onWindow: (page: Page) => void,
): Promise<Page> {
  const window = await running.app.firstWindow({ timeout: WINDOW_TIMEOUT_MS });
  window.setDefaultTimeout(ACTION_TIMEOUT_MS);
  onWindow(window);
  await window.evaluate("document.fonts.ready");
  return window;
}

export async function openSettings(window: Page, note: Note): Promise<void> {
  const open = window.getByRole("button", { name: "Settings", exact: true });
  await open.waitFor({ state: "visible", timeout: WINDOW_TIMEOUT_MS });
  await open.click();
  await note("opened Settings");
}

export const SETTINGS_BACK_LABEL = "Back to app";

export async function closeSettings(window: Page): Promise<void> {
  await window.getByRole("button", { name: SETTINGS_BACK_LABEL, exact: true }).click();
}

export async function chooseRepository(window: Page, path: string): Promise<void> {
  await window.evaluate(`window.rde.testFolderQueue({ path: ${JSON.stringify(path)} })`);
  await window.getByRole("button", { name: "Choose folder" }).click();
}

export async function seedRepository(): Promise<string> {
  const path = await temporaryDir("rde-repo-");
  await execFileAsync("git", ["init", "--initial-branch", "main", path]);
  await mkdir(join(path, "transforms"), { recursive: true });
  await writeFile(join(path, "transforms", ".keep"), "", "utf8");
  await git(path, "add", ".");
  await git(
    path,
    "-c",
    "user.email=rde@example.com",
    "-c",
    "user.name=RDE",
    "commit",
    "-m",
    "seed",
  );
  return path;
}

export async function writeSetupScript(repositoryPath: string, line: string): Promise<void> {
  await mkdir(join(repositoryPath, ".rde"), { recursive: true });
  await writeFile(join(repositoryPath, ".rde", "setup"), `#!/bin/sh\necho "${line}"\n`, {
    encoding: "utf8",
    mode: EXECUTABLE_FILE_MODE,
  });
}

export async function expectVisible(window: Page, text: string): Promise<void> {
  await window
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: WINDOW_TIMEOUT_MS });
}

export function requireLine(stdout: string, what: string): string {
  const line = stdout.split("\n")[0]?.trim();
  if (line === undefined || line.length === 0) {
    throw new DriverFailure(`git named no ${what}`);
  }
  return line;
}

export const WORKTREE_OPTION = "New worktree";
export const IN_PLACE_OPTION = "In the repository";

// Picks an option from the composer chip that holds the choice (`workspace`, `permission`, ...).
export async function chooseOption(window: Page, choice: string, option: string): Promise<void> {
  await window.locator(`[data-prompt-bar] [data-chip~="${choice}"]`).click();
  await window.getByRole("menuitemradio", { name: option, exact: true }).click();
  await window.getByRole("menu").waitFor({ state: "detached" });
}

export async function startSession(window: Page, prompt: string, workspace: string): Promise<void> {
  await window.locator("[data-prompt]").fill(prompt);
  await chooseOption(window, "workspace", workspace);
  await window.getByRole("button", { name: "Send", exact: true }).click();
}

export async function sendFollowUp(window: Page, prompt: string): Promise<void> {
  await window.locator("[data-prompt]").fill(prompt);
  await window.getByRole("button", { name: "Send", exact: true }).click();
}

export interface TranscriptRow {
  readonly kind: string;
  readonly text: string;
}

export async function readTranscript(window: Page): Promise<TranscriptRow[]> {
  const rows = window.locator("[data-row]");
  await rows.first().waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  const count = await rows.count();
  const read: TranscriptRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const kind = await row.getAttribute("data-row");
    read.push({ kind: kind === null ? "" : kind, text: await row.innerText() });
  }
  return read;
}

export function requireRow(rows: readonly TranscriptRow[], kind: string, text: string): void {
  const found = rows.some((row) => row.kind === kind && row.text.includes(text));
  if (!found) {
    const seen = rows.map((row) => `${row.kind}: ${row.text}`).join("\n");
    throw new DriverFailure(`the timeline holds no ${kind} row saying "${text}"\n${seen}`);
  }
}

export async function awaitRow(window: Page, kind: string): Promise<string> {
  const row = window.locator(`[data-row="${kind}"]`).first();
  await row.waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
  return row.innerText();
}

export async function openFoldedWork(window: Page, toolLabel: string): Promise<void> {
  const fold = window.locator('[data-row="fold"]').first();
  if ((await fold.count()) > 0) {
    await fold.click();
  }
  const tool = window.locator('[data-row="tool"]').filter({ hasText: toolLabel }).first();
  await tool.getByRole("button").first().click();
}

export async function stopEverySession(window: Page): Promise<void> {
  const listed: unknown = await window.evaluate("window.rde.sessionsList()");
  const index = SessionIndex.parse(listed);
  for (const entry of index.sessions) {
    await window.evaluate(`window.rde.sessionsStop({ sessionId: ${JSON.stringify(entry.id)} })`);
  }
}

export async function pointAtWorktreeRoot(
  window: Page,
  note: Note,
  repositoryPath: string,
  worktreeRoot: string,
): Promise<void> {
  await expectVisible(window, "Finish setting up");
  await openSettings(window, note);
  await window.getByRole("button", { name: "Repository", exact: true }).click();
  await chooseRepository(window, repositoryPath);
  await expectVisible(window, repositoryPath);
  await window.getByLabel("Worktree root").fill(worktreeRoot);
  await window.getByRole("button", { name: "Save worktree root" }).click();
  await expectVisible(window, "Saved");
  await closeSettings(window);
  await note(`repository ${repositoryPath}, worktrees under ${worktreeRoot}`);
}

export function themeSelect(window: Page): Locator {
  return window.getByRole("combobox", { name: "Theme", exact: true });
}

export async function pickTheme(window: Page, theme: string): Promise<void> {
  await themeSelect(window).selectOption({ label: theme });
}

export async function chooseTheme(window: Page, theme: string): Promise<void> {
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await window.getByRole("button", { name: "Appearance", exact: true }).click();
  await pickTheme(window, theme);
  await expectVisible(window, "Saved");
  await closeSettings(window);
}

export async function allowUntilCheckpoint(window: Page): Promise<void> {
  const checkpoint = window.locator('[data-row="checkpoint"]').first();
  const allow = window.getByRole("button", { name: "Allow", exact: true }).first();
  for (let asks = 0; asks < MAX_PERMISSION_ASKS; asks += 1) {
    await allow.or(checkpoint).first().waitFor({ state: "visible", timeout: TURN_TIMEOUT_MS });
    if (await checkpoint.isVisible()) {
      return;
    }
    // The answered row stays on screen until the log records the answer, so the loop waits for
    // this ask to leave before it looks for the next one.
    const asked = await allow.elementHandle();
    if (asked === null) {
      continue;
    }
    await asked.click();
    await asked.waitForElementState("hidden");
  }
  throw new DriverFailure(`the turn asked more than ${String(MAX_PERMISSION_ASKS)} permissions`);
}
