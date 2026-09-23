import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Locator, Page } from "playwright";

import type { Workspace } from "../../src/contracts/events";
import { DriverFailure, closeApp, timestamp } from "../app";
import { startClip, type RecordedClip } from "../recorder";
import {
  chooseTheme,
  git,
  openWindow,
  seedRepository,
  start,
  temporaryDir,
  type Note,
  type Scenario,
} from "../scenario";

import { COLLAPSE_CHORD, DIFF_OPTIONS, seedRemote } from "./changes";
import { writeFixtureSession } from "./fixture";

const UNIT = "u13";
const CLIP_NAME = `${UNIT}-changes`;
const BRANCH = "rde/clean-the-orders-transform";
const BASE = "main";
const ORIGIN = "origin";

const AUTHOR = ["-c", "user.email=rde@example.com", "-c", "user.name=RDE"] as const;

const ORDERS_SQL = "-- draft\nselect id, status, total\nfrom orders\n";
const ORDERS_YAML = "name: orders\ndescription: draft\n";
const CLEANED_SQL =
  "-- cleaned orders\nselect id, status, total\nfrom orders\nwhere status <> 'test'\n";
const CLEANED_YAML = "name: orders\ndescription: cleaned\n";
const FOLLOW_UP_YAML = "name: orders\ndescription: cleaned, test rows dropped\n";
const OTHER_YAML = "name: orders\ndescription: edited elsewhere\n";

const SIDE_PANEL_HANDLE = "Resize the side panel";
const SETTLE_MS = 600;
const REFUSED_TEXT = "origin refused the push.";
const MORE_ACTIONS = "More branch actions";
const NO_PRIMARY = "none";

const WIDTHS = ["default", "narrow"] as const;
type PanelWidth = (typeof WIDTHS)[number];

const THEMES = [
  { slug: "light", label: "Light" },
  { slug: "dark", label: "Dark" },
] as const;

// A state that lives in a dialog is opened for each shot, because the theme is chosen in Settings,
// which a modal dialog covers.
interface Staging {
  readonly open: (window: Page) => Promise<void>;
  readonly close: (window: Page) => Promise<void>;
}

interface StatesRun {
  readonly window: Page;
  readonly dir: string;
  readonly note: Note;
  readonly shots: string[];
}

function panel(window: Page): Locator {
  return window.getByRole("complementary", { name: "Side panel" });
}

function checkpointRef(sessionId: string, seq: number): string {
  return `refs/rde/checkpoints/${sessionId}/${String(seq)}`;
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, "add", "-A");
  await git(cwd, ...AUTHOR, "commit", "--quiet", "-m", message);
}

async function writeContent(cwd: string, sql: string, yaml: string): Promise<void> {
  await mkdir(join(cwd, "models"), { recursive: true });
  await writeFile(join(cwd, "transforms", "orders.sql"), sql, "utf8");
  await writeFile(join(cwd, "models", "orders.yaml"), yaml, "utf8");
}

// The panel reads the branch when it mounts; hiding and showing it is how a person makes it look
// again after git moved underneath it.
async function reread(window: Page): Promise<void> {
  await window.locator("[data-prompt]").focus();
  await window.keyboard.press(COLLAPSE_CHORD);
  await panel(window).waitFor({ state: "detached" });
  await window.keyboard.press(COLLAPSE_CHORD);
  await panel(window).locator("[data-sync]").waitFor({ state: "visible" });
  await window.waitForTimeout(SETTLE_MS);
}

async function setPanelWidth(window: Page, width: PanelWidth): Promise<void> {
  const handle = window.getByRole("separator", { name: SIDE_PANEL_HANDLE });
  if (width === "narrow") {
    await handle.focus();
    await window.keyboard.press("Home");
  } else {
    await handle.dblclick();
    await window.mouse.move(0, 0);
  }
  await window.locator("[data-prompt]").focus();
  await window.waitForTimeout(SETTLE_MS);
}

async function primaryAction(window: Page): Promise<string> {
  const button = panel(window).locator("[data-primary-action]");
  if ((await button.count()) === 0) {
    return NO_PRIMARY;
  }
  const action = await button.getAttribute("data-primary-action");
  return action === null ? NO_PRIMARY : action;
}

async function requirePrimary(run: StatesRun, state: string, expected: string): Promise<void> {
  const shown = await primaryAction(run.window);
  await run.note(`${state}: the primary action is ${shown}`);
  if (shown !== expected) {
    throw new DriverFailure(`${state} leads with ${shown}, not ${expected}`);
  }
}

// A menu is shot open, then closed with Escape, so every action and option is seen one click away.
async function shootMenu(run: StatesRun, trigger: string, slug: string): Promise<void> {
  await panel(run.window).getByRole("button", { name: trigger, exact: true }).click();
  const menu = run.window.getByRole("menu");
  await menu.waitFor({ state: "visible" });
  await run.window.waitForTimeout(SETTLE_MS);
  const path = join(run.dir, `${timestamp()}_${UNIT}-changes-${slug}.png`);
  await run.window.screenshot({ path });
  run.shots.push(path);
  await run.note(`${slug}: ${(await menu.innerText()).replaceAll("\n", " | ")}; ${path}`);
  await run.window.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
}

// Each state is shot at the side panel's narrowest and default widths, in both themes.
async function shootState(run: StatesRun, state: string, staging: Staging | null): Promise<void> {
  for (const theme of THEMES) {
    await chooseTheme(run.window, theme.label);
    for (const width of WIDTHS) {
      await setPanelWidth(run.window, width);
      await staging?.open(run.window);
      const path = join(
        run.dir,
        `${timestamp()}_${UNIT}-changes-${state}-${width}-${theme.slug}.png`,
      );
      await run.window.screenshot({ path });
      run.shots.push(path);
      await run.note(`${state}, ${width}, ${theme.slug}: ${path}`);
      await staging?.close(run.window);
    }
  }
  await chooseTheme(run.window, THEMES[0].label);
  const sync = await panel(run.window).locator("[data-sync]").innerText();
  await run.note(`${state}: the branch line reads "${sync.replaceAll("\n", " ")}"`);
}

// Another clone moved the branch on origin, so the next push is not a fast-forward.
async function moveRemoteBranch(bare: string): Promise<void> {
  const other = await temporaryDir("rde-other-clone-");
  await git(other, "clone", "--quiet", "--branch", BRANCH, bare, ".");
  await writeFile(join(other, "models", "orders.yaml"), OTHER_YAML, "utf8");
  await commitAll(other, "edit elsewhere");
  await git(other, "push", "--quiet", ORIGIN, BRANCH);
}

const REFUSED_PUSH: Staging = {
  open: async (window) => {
    await panel(window).getByRole("button", { name: "Push", exact: true }).click();
    const dialog = window.getByRole("dialog");
    await dialog.getByText(REFUSED_TEXT).waitFor({ state: "visible" });
    const force = dialog.getByRole("button", { name: "Force with lease" });
    if (!(await force.isVisible())) {
      throw new DriverFailure("a refused push on the app's own branch offers no force-with-lease");
    }
    await window.waitForTimeout(SETTLE_MS);
  },
  close: async (window) => {
    const dialog = window.getByRole("dialog");
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached" });
  },
};

const CHANGES_STATES: Scenario = {
  name: "changes-states",
  unit: UNIT,
  gate: null,
  act: async ({ dir, note, onWindow }) => {
    const repositoryPath = await seedRepository();
    await writeContent(repositoryPath, ORDERS_SQL, ORDERS_YAML);
    await commitAll(repositoryPath, "content");
    const bare = await seedRemote(repositoryPath);
    const worktree = join(await temporaryDir("rde-worktrees-"), "orders");
    await git(repositoryPath, "worktree", "add", "--quiet", "-b", BRANCH, worktree, BASE);
    const workspace: Workspace = { kind: "worktree", path: worktree, branch: BRANCH, base: BASE };
    const fixture = await writeFixtureSession(1, workspace);
    await git(worktree, "update-ref", checkpointRef(fixture.sessionId, 0), "HEAD");
    await git(worktree, "update-ref", checkpointRef(fixture.sessionId, 1), "HEAD");
    await note(
      `session ${fixture.sessionId} on ${BRANCH} in ${worktree}; origin pushes to ${bare}`,
    );

    const running = await start(fixture.userDataDir, undefined);
    const window = await openWindow(running, onWindow);
    const clip = startClip(dir, CLIP_NAME);
    let recorded: RecordedClip;
    let shots: readonly string[];
    try {
      await window.getByRole("button", { name: fixture.title }).click();
      await panel(window).locator("[data-sync]").waitFor({ state: "visible" });
      const run: StatesRun = { window, dir, note, shots: [] };

      await shootState(run, "clean", null);
      await requirePrimary(run, "clean", NO_PRIMARY);
      await shootMenu(run, MORE_ACTIONS, "clean-actions-menu");

      await writeContent(worktree, CLEANED_SQL, CLEANED_YAML);
      const turn = (await git(worktree, "stash", "create")).trim();
      await git(worktree, "update-ref", checkpointRef(fixture.sessionId, 1), turn);
      await reread(window);
      await shootState(run, "uncommitted", null);
      await requirePrimary(run, "uncommitted", "commit");
      await shootMenu(run, MORE_ACTIONS, "uncommitted-actions-menu");
      await shootMenu(run, DIFF_OPTIONS, "uncommitted-diff-options");

      await commitAll(worktree, "Clean the orders transform");
      await reread(window);
      await shootState(run, "committed", null);
      await requirePrimary(run, "committed", "push");

      await git(worktree, "push", "--quiet", "--set-upstream", ORIGIN, BRANCH);
      await reread(window);
      await shootState(run, "pushed", null);
      await requirePrimary(run, "pushed", "pull-request");
      await shootMenu(run, MORE_ACTIONS, "pushed-actions-menu");

      await moveRemoteBranch(bare);
      await writeContent(worktree, CLEANED_SQL, FOLLOW_UP_YAML);
      await commitAll(worktree, "Drop the test rows");
      await reread(window);
      await requirePrimary(run, "refused-push", "push");
      await shootState(run, "refused-push", REFUSED_PUSH);
      shots = run.shots;
    } finally {
      recorded = await clip.stop();
    }
    await note(`clip ${recorded.path}, ${recorded.seconds.toFixed(1)} s`);
    await closeApp(running);
    return [...shots, recorded.path].join(", ");
  },
};

export const CHANGES_STATE_SCENARIOS: readonly Scenario[] = [CHANGES_STATES];
